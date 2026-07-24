const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

module.exports = { register, login, logout, getMe };
