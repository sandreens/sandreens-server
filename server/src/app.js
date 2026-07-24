const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const chatRoutes = require('./routes/chatRoutes');
const HomepageContent = require('./models/HomepageContent');
const { DEFAULT_CMS_DATA } = require('./controllers/cmsController');

dotenv.config();
connectDB();

const app = express();

// Allowed origins list
const defaultOrigins = [
    'https://sandreens.com',
    'https://www.sandreens.com',
    'https://admin.sandreens.com',
    'http://localhost:5173',
    'http://localhost:5174'
];

const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [];

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, or Postman)
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            // Reject cleanly without throwing a server-side exception (prevents 500 Internal Server Error)
            callback(null, false);
        }
    },
    credentials: true, // Allow cookie transmission or authorization headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Apply CORS middleware to all routes
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api/auth',               require('./routes/authRoutes'));
app.use('/api/products',           require('./routes/productRoutes'));
app.use('/api/orders',             require('./routes/orderRoutes'));
app.use('/api/users',              require('./routes/userRoutes'));
app.use('/api/categories',         require('./routes/categoryRoutes'));
app.use('/api/cms',                require('./routes/cmsRoutes'));
app.use('/api/settings',           require('./routes/settingsRoutes'));
app.use('/api/faqs',               require('./routes/faqRoutes'));
app.use('/api/testimonials',       require('./routes/testimonialRoutes'));
app.use('/api/blogs',              require('./routes/blogRoutes'));
app.use('/api/homepage-sections', require('./routes/homepageSectionRoutes'));
app.use('/api/coupons',            require('./routes/couponRoutes'));
app.use('/api/payment',            require('./routes/paymentRoutes'));
app.use('/api/chat', chatRoutes);
app.use('/api/trending-cards',     require('./routes/trendingCardRoutes'));
app.use('/api/promo-cards',        require('./routes/promoCardRoutes'));

app.use('/api/config',             require('./routes/configRoutes'));
// Alias route for instagram-posts
app.get('/api/instagram-posts', async (req, res) => {
    try {
        const section = await HomepageContent.findOne({ sectionKey: 'instagramGrid' });
        res.json(section?.data || DEFAULT_CMS_DATA.instagramGrid);
    } catch {
        res.json(DEFAULT_CMS_DATA.instagramGrid);
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Sandreens API is running' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: err.message || 'Internal Server Error' });
});

module.exports = app;
