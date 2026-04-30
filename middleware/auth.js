const jwt = require('jsonwebtoken');

// Secret key should normally be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

const requireAuth = (req, res, next) => {
    const token = req.cookies.jwt;

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decodedToken) => {
            if (err) {
                console.error('JWT verification failed:', err.message);
                res.redirect('/login');
            } else {
                req.user = decodedToken;
                next();
            }
        });
    } else {
        res.redirect('/login');
    }
};

module.exports = { requireAuth, JWT_SECRET };
