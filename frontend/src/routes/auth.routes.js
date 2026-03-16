// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { sendOTP, verifyOTP, setMPIN, loginWithMPIN, verifyToken, logout } = require('../controllers/auth.controller');
const { loginWithMobileMpin, getSubscriptionStatus } = require('../controllers/auth.direct');

// Existing OTP flow
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/set-mpin', setMPIN);
router.post('/login', loginWithMPIN);
router.get('/verify', authMiddleware, verifyToken);
router.post('/logout', authMiddleware, logout);

// Direct mobile + MPIN login (for Electron desktop app)
router.post('/login-mpin', loginWithMobileMpin);
router.get('/subscription', authMiddleware, getSubscriptionStatus);

module.exports = router;