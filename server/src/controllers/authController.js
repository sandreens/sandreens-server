const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

const generateToken = (res, userId) => {
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '30d'
    });

    const isDev = process.env.NODE_ENV === 'development';
    res.cookie('token', token, {
        httpOnly: true,
        secure: !isDev,
        sameSite: isDev ? 'lax' : 'none',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    return token;
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const normalizedEmail = email ? email.toLowerCase().trim() : '';

        const exists = await User.findOne({ email: normalizedEmail });
        if (exists) return res.status(400).json({ message: 'User already exists' });

        const user = await User.create({ name, email: normalizedEmail, password, role: role || 'user' });

        generateToken(res, user._id);

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
        });
    } catch (error) {
        console.log('REGISTER ERROR 👉', error);
        const errMsg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
        res.status(500).json({ message: errMsg });
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email ? email.toLowerCase().trim() : '';
        console.log(`[AUTH] Login attempt for: ${normalizedEmail}`);

        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            console.log(`[AUTH] Login failed: User not found for ${normalizedEmail}`);
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        const matches = await user.matchPassword(password);
        if (!matches) {
            console.log(`[AUTH] Login failed: Password mismatch for ${normalizedEmail}`);
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        console.log(`[AUTH] Login success: ${normalizedEmail} (Role: ${user.role})`);
        generateToken(res, user._id);

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
        });
    } catch (error) {
        console.log(`[AUTH] Login error for ${req.body.email}: ${error.message}`);
        const errMsg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
        res.status(500).json({ message: errMsg });
    }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = (req, res) => {
    const isDev = process.env.NODE_ENV === 'development';
    res.cookie('token', '', {
        httpOnly: true,
        secure: !isDev,
        sameSite: isDev ? 'lax' : 'none',
        expires: new Date(0)
    });
    res.json({ message: 'Logged out successfully' });
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
    res.json({
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role
    });
};

// @desc    Send password reset link to email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const normalizedEmail = email ? email.toLowerCase().trim() : '';

        const user = await User.findOne({ email: normalizedEmail });
        // Security: user na paoa gele o same message pathai, jate keu email exist kina bujhte na pare
        if (!user) {
            return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        user.resetPasswordToken = hashedToken;
        user.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 minutes
        await user.save();

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        const resetUrl = `${clientUrl}/reset-password/${resetToken}`;

        try {
            await sendEmail({
                to: user.email,
                subject: 'Password Reset Request',
                html: `
                    <p>Hi ${user.name},</p>
                    <p>You requested a password reset. Click the link below to set a new password. This link expires in 30 minutes.</p>
                    <p><a href="${resetUrl}">${resetUrl}</a></p>
                    <p>If you didn't request this, please ignore this email.</p>
                `
            });
        } catch (emailErr) {
            console.log('EMAIL SEND ERROR 👉', emailErr);
            user.resetPasswordToken = null;
            user.resetPasswordExpire = null;
            await user.save();
            return res.status(500).json({ message: 'Failed to send reset email. Please try again later.' });
        }

        res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    } catch (error) {
        console.log('FORGOT PASSWORD ERROR 👉', error);
        const errMsg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
        res.status(500).json({ message: errMsg });
    }
};

// @desc    Reset password using token
// @route   POST /api/auth/reset-password/:token
// @access  Public
const resetPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired reset link' });
        }

        user.password = password; // pre('save') hook automatically hash kore dibe
        user.resetPasswordToken = null;
        user.resetPasswordExpire = null;
        await user.save();

        res.json({ message: 'Password reset successful' });
    } catch (error) {
        console.log('RESET PASSWORD ERROR 👉', error);
        const errMsg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
        res.status(500).json({ message: errMsg });
    }
};

// @desc    Update logged-in user's profile (name/email)
// @route   PUT /api/auth/update-profile
// @access  Private
const updateProfile = async (req, res) => {
    try {
        const { name, email } = req.body;
        const normalizedEmail = email ? email.toLowerCase().trim() : '';

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Email onno kono user er sathe conflict korche kina check kori
        if (normalizedEmail && normalizedEmail !== user.email) {
            const emailTaken = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
            if (emailTaken) {
                return res.status(400).json({ message: 'This email is already in use' });
            }
            user.email = normalizedEmail;
        }

        if (name) user.name = name.trim();

        const updated = await user.save();

        res.json({
            _id: updated._id,
            name: updated.name,
            email: updated.email,
            role: updated.role
        });
    } catch (error) {
        console.log('UPDATE PROFILE ERROR 👉', error);
        const errMsg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
        res.status(500).json({ message: errMsg });
    }
};

// @desc    Change logged-in user's password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const matches = await user.matchPassword(currentPassword);
        if (!matches) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        user.password = newPassword; // pre('save') hook automatically hash kore dibe
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.log('CHANGE PASSWORD ERROR 👉', error);
        const errMsg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
        res.status(500).json({ message: errMsg });
    }
};

module.exports = { register, login, logout, getMe, forgotPassword, resetPassword, updateProfile, changePassword };
