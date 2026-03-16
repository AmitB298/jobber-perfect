// src/controllers/auth.direct.js
// Direct login with mobile + MPIN (no OTP step required)
// Used by the Electron desktop app after user has already registered via website

require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

async function loginWithMobileMpin(req, res) {
  const { mobile, mpin } = req.body;

  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ success: false, message: 'Invalid mobile number' });
  }

  if (!mpin || !/^\d{6}$/.test(mpin)) {
    return res.status(400).json({ success: false, message: 'MPIN must be 6 digits' });
  }

  try {
    // Get user with their active plan
    const userResult = await pool.query(
      `SELECT u.id, u.mobile, u.name, u.mpin_hash, u.is_active,
              up.plan_type, up.end_date, up.is_active as plan_active
       FROM users u
       LEFT JOIN user_plans up ON up.user_id = u.id AND up.is_active = true AND up.end_date > NOW()
       WHERE u.mobile = $1
       ORDER BY up.end_date DESC NULLS LAST
       LIMIT 1`,
      [mobile]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Mobile number not registered' });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is disabled. Contact support.' });
    }

    if (!user.mpin_hash) {
      return res.status(401).json({ success: false, message: 'MPIN not set. Please complete registration on optionlab.in' });
    }

    const validMpin = await bcrypt.compare(mpin, user.mpin_hash);
    if (!validMpin) {
      return res.status(401).json({ success: false, message: 'Incorrect MPIN' });
    }

    // Determine subscription status
    const hasActivePlan = !!user.plan_type && !!user.plan_active;
    const daysRemaining = hasActivePlan
      ? Math.ceil((new Date(user.end_date) - new Date()) / (1000 * 60 * 60 * 24))
      : 0;

    const subscriptionStatus = hasActivePlan ? 'active' : 'expired';

    // Issue JWT
    const token = jwt.sign(
      { userId: user.id, mobile: user.mobile },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        mobile: user.mobile,
        name: user.name || '',
        plan: user.plan_type || 'none',
        subscriptionStatus,
        daysRemaining: hasActivePlan ? daysRemaining : 0,
      },
    });

  } catch (err) {
    console.error('loginWithMobileMpin error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

async function getSubscriptionStatus(req, res) {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT plan_type, end_date, is_active
       FROM user_plans
       WHERE user_id = $1 AND is_active = true AND end_date > NOW()
       ORDER BY end_date DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, status: 'expired', plan: 'none', daysRemaining: 0 });
    }

    const plan = result.rows[0];
    const daysRemaining = Math.ceil((new Date(plan.end_date) - new Date()) / (1000 * 60 * 60 * 24));

    return res.json({
      success: true,
      status: 'active',
      plan: plan.plan_type,
      daysRemaining,
      endDate: plan.end_date,
    });

  } catch (err) {
    console.error('getSubscriptionStatus error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

module.exports = { loginWithMobileMpin, getSubscriptionStatus };