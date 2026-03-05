import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('CRITICAL: JWT_SECRET and JWT_REFRESH_SECRET must be set in environment variables');
}

if (JWT_SECRET.length < 32 || JWT_REFRESH_SECRET.length < 32) {
  throw new Error('CRITICAL: JWT secrets must be at least 32 characters long');
}

const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

export interface TokenPayload {
  userId: string;
  email: string;
  plan: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  family?: string;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(
    {
      ...payload,
      jti: uuidv4()
    },
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: 'jobber-pro',
      audience: 'jobber-desktop',
      algorithm: 'HS256'
    } as jwt.SignOptions
  );
};

export const generateRefreshToken = (userId: string, family?: string): string => {
  return jwt.sign(
    {
      userId,
      tokenId: uuidv4(),
      family: family || uuidv4()
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRY,
      issuer: 'jobber-pro',
      audience: 'jobber-desktop',
      algorithm: 'HS256'
    } as jwt.SignOptions
  );
};

export const generateTokenPair = (payload: TokenPayload, tokenFamily?: string): TokenPair => {
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload.userId, tokenFamily);
  const decoded = jwt.decode(accessToken) as any;
  const expiresAt = decoded.exp * 1000;
  return { accessToken, refreshToken, expiresAt };
};

export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'jobber-pro',
      audience: 'jobber-desktop',
      algorithms: ['HS256']
    }) as TokenPayload;
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('ACCESS_TOKEN_EXPIRED');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('INVALID_ACCESS_TOKEN');
    } else {
      throw new Error('TOKEN_VERIFICATION_FAILED');
    }
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
      issuer: 'jobber-pro',
      audience: 'jobber-desktop',
      algorithms: ['HS256']
    }) as RefreshTokenPayload;
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('REFRESH_TOKEN_EXPIRED');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('INVALID_REFRESH_TOKEN');
    } else {
      throw new Error('TOKEN_VERIFICATION_FAILED');
    }
  }
};

export const getRefreshTokenExpiry = (): Date => {
  const expiry = new Date();
  const match = REFRESH_TOKEN_EXPIRY.match(/^(\d+)([dhms])$/);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'd': expiry.setDate(expiry.getDate() + value); break;
      case 'h': expiry.setHours(expiry.getHours() + value); break;
      case 'm': expiry.setMinutes(expiry.getMinutes() + value); break;
      case 's': expiry.setSeconds(expiry.getSeconds() + value); break;
    }
  } else {
    expiry.setDate(expiry.getDate() + 7);
  }
  return expiry;
};

export const extractTokenFamily = (token: string): string | null => {
  try {
    const decoded = jwt.decode(token) as RefreshTokenPayload;
    return decoded.family || null;
  } catch {
    return null;
  }
};
