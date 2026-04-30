const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const crypto = require('crypto');

const maxAge = 3 * 24 * 60 * 60; // 3 days in seconds

// Render login page
router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Handle login POST
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err) {
            console.error('Database error during login:', err);
            return res.render('login', { error: 'An error occurred. Please try again.' });
        }
        
        if (user) {
            const auth = await bcrypt.compare(password, user.password_hash);
            if (auth) {
                // Create token
                const token = jwt.sign(
                    { user_id: user.user_id, role: user.role },
                    JWT_SECRET,
                    { expiresIn: maxAge }
                );
                
                // Set cookie
                res.cookie('jwt', token, { httpOnly: true, maxAge: maxAge * 1000 });
                return res.redirect('/offers');
            }
        }
        
        res.render('login', { error: 'Invalid email or password.' });
    });
});

// Handle logout POST/GET
router.post('/logout', (req, res) => {
    res.cookie('jwt', '', { maxAge: 1 });
    res.redirect('/login');
});
router.get('/logout', (req, res) => {
    res.cookie('jwt', '', { maxAge: 1 });
    res.redirect('/login');
});

// GET invite registration form
router.get('/invite/:token', (req, res) => {
    const token = req.params.token;
    db.get(`SELECT * FROM users WHERE invite_token = ?`, [token], (err, user) => {
        if (err || !user) {
            return res.status(404).send('Ungültiger oder abgelaufener Einladungslink.');
        }
        res.render('complete_registration', { error: null, email: user.email, token });
    });
});

// POST invite registration form
router.post('/invite/:token', async (req, res) => {
    const token = req.params.token;
    const { name, password, phone_number } = req.body;

    if (!name || !password) {
        return res.render('complete_registration', { error: 'Name und Passwort sind erforderlich.', email: req.body.email || '', token });
    }

    db.get(`SELECT * FROM users WHERE invite_token = ?`, [token], async (err, user) => {
        if (err || !user) {
            return res.status(404).send('Ungültiger oder abgelaufener Einladungslink.');
        }

        try {
            const hash = await bcrypt.hash(password, 10);
            
            db.run(`UPDATE users SET password_hash = ?, name = ?, phone_number = ?, invite_token = NULL WHERE user_id = ?`, 
                [hash, name, phone_number || null, user.user_id], 
                function(updateErr) {
                    if (updateErr) {
                        console.error(updateErr);
                        return res.render('complete_registration', { error: 'Datenbankfehler aufgetreten.', email: user.email, token });
                    }

                    // Log them in immediately
                    const jwtToken = jwt.sign(
                        { user_id: user.user_id, role: user.role },
                        JWT_SECRET,
                        { expiresIn: maxAge }
                    );
                    
                    res.cookie('jwt', jwtToken, { httpOnly: true, maxAge: maxAge * 1000 });
                    return res.redirect('/offers');
            });
        } catch (e) {
            console.error(e);
            res.render('complete_registration', { error: 'Fehler beim Hashen des Passworts.', email: user.email, token });
        }
    });
});

// Authentication Logic

// GET forgot password
router.get('/forgot-password', (req, res) => {
    res.render('forgot_password', { error: null, success: null });
});

// POST forgot password
router.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err || !user) {
            // We show success anyway to prevent email enumeration, but in this dev env maybe just show error if not found?
            // User requested "Everyone must be able to reset", so let's be helpful.
            return res.render('forgot_password', { error: 'Benutzer mit dieser E-Mail wurde nicht gefunden.', success: null });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

        db.run(`UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE user_id = ?`, 
            [token, expiry, user.user_id], 
            (updateErr) => {
                if (updateErr) {
                    return res.render('forgot_password', { error: 'Datenbankfehler.', success: null });
                }
                
                const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
                console.log(`Password reset link for ${email}: ${resetLink}`);
                
                res.render('forgot_password', { 
                    error: null, 
                    success: 'Ein Rücksetz-Link wurde generiert (siehe unten).',
                    resetLink: resetLink 
                });
        });
    });
});

// GET reset password
router.get('/reset-password/:token', (req, res) => {
    const token = req.params.token;
    db.get(`SELECT * FROM users WHERE reset_token = ?`, [token], (err, user) => {
        if (err || !user) {
            return res.status(404).send('Ungültiger oder abgelaufener Link.');
        }

        const now = new Date().toISOString();
        if (user.reset_token_expiry < now) {
            return res.status(400).send('Dieser Link ist abgelaufen.');
        }

        res.render('reset_password', { error: null, token });
    });
});

// POST reset password
router.post('/reset-password/:token', async (req, res) => {
    const token = req.params.token;
    const { password, confirm_password } = req.body;

    if (password !== confirm_password) {
        return res.render('reset_password', { error: 'Passwörter stimmen nicht überein.', token });
    }

    db.get(`SELECT * FROM users WHERE reset_token = ?`, [token], async (err, user) => {
        if (err || !user) {
            return res.status(404).send('Ungültiger oder abgelaufener Link.');
        }

        const now = new Date().toISOString();
        if (user.reset_token_expiry < now) {
            return res.status(400).send('Dieser Link ist abgelaufen.');
        }

        try {
            const hash = await bcrypt.hash(password, 10);
            db.run(`UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE user_id = ?`, 
                [hash, user.user_id], 
                (updateErr) => {
                    if (updateErr) {
                        return res.render('reset_password', { error: 'Datenbankfehler.', token });
                    }
                    res.render('login', { error: null, success: 'Passwort erfolgreich zurückgesetzt. Du kannst dich jetzt einloggen.' });
            });
        } catch (e) {
            res.render('reset_password', { error: 'Fehler beim Hashen.', token });
        }
    });
});

const { requireAuth } = require('../middleware/auth');

// GET profile (authenticated)
router.get('/profile', requireAuth, (req, res) => {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [req.user.user_id], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        // Fetch user's schools
        db.all(`
            SELECT s.* FROM schools s
            JOIN user_schools us ON s.school_id = us.school_id
            WHERE us.user_id = ?
        `, [req.user.user_id], (schoolErr, userSchools) => {
            res.render('profile', { 
                error: null, 
                success: null, 
                user: user,
                userSchools: userSchools || [],
                activePage: 'profile' 
            });
        });
    });
});

// POST update profile details
router.post('/profile/update', requireAuth, (req, res) => {
    const { name, phone_number } = req.body;
    
    db.run(`UPDATE users SET name = ?, phone_number = ? WHERE user_id = ?`,
        [name, phone_number, req.user.user_id],
        function(err) {
            if (err) {
                return res.render('profile', { 
                    error: 'Fehler beim Aktualisieren der Daten.', 
                    success: null, 
                    user: { ...req.user, name, phone_number },
                    userSchools: [], // Simplified for error state
                    activePage: 'profile' 
                });
            }
            res.redirect('/profile?success=profile');
        }
    );
});

// POST change password (from profile)
router.post('/profile/password', requireAuth, async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;

    if (new_password !== confirm_password) {
        return res.redirect('/profile?error=match');
    }

    db.get(`SELECT * FROM users WHERE user_id = ?`, [req.user.user_id], async (err, user) => {
        if (err || !user) return res.redirect('/login');

        const auth = await bcrypt.compare(current_password, user.password_hash);
        if (!auth) {
            return res.redirect('/profile?error=current');
        }

        try {
            const hash = await bcrypt.hash(new_password, 10);
            db.run(`UPDATE users SET password_hash = ? WHERE user_id = ?`, [hash, user.user_id], (updateErr) => {
                if (updateErr) return res.redirect('/profile?error=db');
                res.redirect('/profile?success=password');
            });
        } catch (e) {
            res.redirect('/profile?error=hash');
        }
    });
});

// Redirect old change-password route to new profile
router.get('/change-password', (req, res) => res.redirect('/profile'));
router.post('/change-password', (req, res) => res.redirect('/profile'));

module.exports = router;
