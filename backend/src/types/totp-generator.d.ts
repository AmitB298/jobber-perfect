declare module 'totp-generator' {
  export class TOTP {
    constructor(options?: {
      digits?: number;
      algorithm?: string;
      period?: number;
    });
    generate(secret: string, timestamp?: number): string;
  }
  
  export function totp(secret: string, options?: {
    digits?: number;
    algorithm?: string;
    period?: number;
    timestamp?: number;
  }): string;
}
