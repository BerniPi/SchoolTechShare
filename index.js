const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const { db, initializeDb } = require('./database');
const { requireAuth } = require('./middleware/auth');
const listingsRoutes = require('./routes/r_listings');
const authRoutes = require('./routes/r_auth');
const adminRoutes = require('./routes/r_admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Public Routes (Login/Logout)
app.use(authRoutes);

// Protect all following routes with requireAuth middleware
app.use(requireAuth);

// Protected Routes
app.use('/admin', adminRoutes);
app.use('/', listingsRoutes);

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
