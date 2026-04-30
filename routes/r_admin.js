const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../database');

// Middleware to ensure user is admin
router.use((req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Forbidden: Admins only');
    }
});

// GET invite form
router.get('/invite', (req, res) => {
    // Fetch schools for the dropdown
    db.all(`SELECT * FROM schools`, (err, schools) => {
        if (err) {
            console.error(err);
            schools = [];
        }
        res.render('admin_invite', { schools, error: null, successLink: null, user: req.user });
    });
});

// POST invite form
router.post('/invite', (req, res) => {
    const { email, school_ids } = req.body;

    if (!email || !school_ids || school_ids.length === 0) {
        return db.all(`SELECT * FROM schools`, (err, schools) => {
            res.render('admin_invite', { schools: schools || [], error: 'E-Mail und mindestens eine Schule sind erforderlich.', successLink: null, user: req.user });
        });
    }

    let ids = Array.isArray(school_ids) ? school_ids : [school_ids];

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    
    // Insert pending user
    // We set password_hash to 'PENDING' since it's NOT NULL
    const insertSql = `INSERT INTO users (email, password_hash, role, invite_token) VALUES (?, 'PENDING', 'user', ?)`;
    
    db.run(insertSql, [email, token], function(err) {
        if (err) {
            console.error(err);
            // Re-fetch schools
            return db.all(`SELECT * FROM schools`, (errSchools, schools) => {
                res.render('admin_invite', { schools: schools || [], error: 'Benutzer existiert bereits oder Datenbankfehler.', successLink: null, user: req.user });
            });
        }

        const userId = this.lastID;
        const insertSchoolSql = `INSERT INTO user_schools (user_id, school_id) VALUES (?, ?)`;
        const stmt = db.prepare(insertSchoolSql);
        
        ids.forEach(id => {
            stmt.run([userId, id]);
        });
        stmt.finalize();

        const inviteLink = `http://localhost:3000/invite/${token}`;
        
        db.all(`SELECT * FROM schools`, (errSchools, schools) => {
            res.render('admin_invite', { schools: schools || [], error: null, successLink: inviteLink, user: req.user });
        });
    });
});

// GET manage schools
router.get('/schools', (req, res) => {
    db.all(`SELECT * FROM schools ORDER BY name ASC`, (err, schools) => {
        if (err) {
            console.error(err);
            schools = [];
        }
        res.render('admin_schools', { schools, error: null, user: req.user });
    });
});

// POST add new school
router.post('/schools', (req, res) => {
    const { school_code, name, address, city } = req.body;

    if (!school_code || !name) {
        return db.all(`SELECT * FROM schools ORDER BY name ASC`, (err, schools) => {
            res.render('admin_schools', { schools: schools || [], error: 'Schulcode und Name sind erforderlich.', user: req.user });
        });
    }

    const insertSql = `INSERT INTO schools (school_code, name, address, city) VALUES (?, ?, ?, ?)`;
    db.run(insertSql, [school_code, name, address, city], function(err) {
        if (err) {
            console.error(err);
            return db.all(`SELECT * FROM schools ORDER BY name ASC`, (errSchools, schools) => {
                res.render('admin_schools', { schools: schools || [], error: 'Schulcode existiert bereits oder Datenbankfehler.', user: req.user });
            });
        }
        res.redirect('/admin/schools');
    });
});

// GET edit school
router.get('/schools/:id/edit', (req, res) => {
    const schoolId = req.params.id;
    db.get(`SELECT * FROM schools WHERE school_id = ?`, [schoolId], (err, school) => {
        if (err || !school) {
            return res.redirect('/admin/schools');
        }
        res.render('admin_school_edit', { school, error: null, user: req.user });
    });
});

// POST edit school
router.post('/schools/:id/edit', (req, res) => {
    const schoolId = req.params.id;
    const { school_code, name, address, city } = req.body;

    if (!school_code || !name) {
        return db.get(`SELECT * FROM schools WHERE school_id = ?`, [schoolId], (err, school) => {
            res.render('admin_school_edit', { school: school || {}, error: 'Schulcode und Name sind erforderlich.', user: req.user });
        });
    }

    db.run(
        `UPDATE schools SET school_code = ?, name = ?, address = ?, city = ? WHERE school_id = ?`,
        [school_code, name, address, city, schoolId],
        function(err) {
            if (err) {
                console.error(err);
                return db.get(`SELECT * FROM schools WHERE school_id = ?`, [schoolId], (errGet, school) => {
                    res.render('admin_school_edit', { school: school || {}, error: 'Schulcode existiert bereits oder Datenbankfehler.', user: req.user });
                });
            }
            res.redirect('/admin/schools');
        }
    );
});

// POST delete school
router.post('/schools/:id/delete', (req, res) => {
    const schoolId = req.params.id;
    
    db.run(`DELETE FROM schools WHERE school_id = ?`, [schoolId], function(err) {
        if (err) {
            if (err.code !== 'SQLITE_CONSTRAINT') {
                console.error(err);
            }
            // Likely a SQLITE_CONSTRAINT error due to foreign keys
            return db.all(`SELECT * FROM schools ORDER BY name ASC`, (errSchools, schools) => {
                res.render('admin_schools', { schools: schools || [], error: 'Diese Schule kann nicht gelöscht werden, da noch Benutzer oder Inserate ihr zugewiesen sind.', user: req.user });
            });
        }
        res.redirect('/admin/schools');
    });
});

// GET users overview
router.get('/users', (req, res) => {
    db.all(`
        SELECT u.user_id, u.email, u.name, u.role, u.invite_token,
        GROUP_CONCAT(s.name, ', ') as school_names
        FROM users u
        LEFT JOIN user_schools us ON u.user_id = us.user_id
        LEFT JOIN schools s ON us.school_id = s.school_id
        GROUP BY u.user_id
        ORDER BY u.name ASC, u.email ASC
    `, (err, users) => {
        if (err) users = [];
        res.render('admin_users', { users, error: null, user: req.user });
    });
});

// GET edit user
router.get('/users/:id/edit', (req, res) => {
    const userId = req.params.id;
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, targetUser) => {
        if (err || !targetUser) return res.redirect('/admin/users');
        
        db.all(`SELECT school_id FROM user_schools WHERE user_id = ?`, [userId], (err, userSchools) => {
            const assignedSchoolIds = (userSchools || []).map(us => us.school_id);
            
            db.all(`SELECT * FROM schools ORDER BY name ASC`, (err, schools) => {
                res.render('admin_user_edit', { 
                    targetUser, 
                    assignedSchoolIds, 
                    schools: schools || [], 
                    error: null, 
                    user: req.user 
                });
            });
        });
    });
});

// POST edit user
router.post('/users/:id/edit', (req, res) => {
    const userId = req.params.id;
    const { name, email, phone_number, role, school_ids } = req.body;
    let ids = Array.isArray(school_ids) ? school_ids : (school_ids ? [school_ids] : []);

    if (!email || !role) {
        return res.redirect(`/admin/users/${userId}/edit`);
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let hasError = false;

        db.run(
            `UPDATE users SET name = ?, email = ?, phone_number = ?, role = ? WHERE user_id = ?`,
            [name || null, email, phone_number || null, role, userId],
            (err) => { if (err) hasError = true; }
        );

        db.run(`DELETE FROM user_schools WHERE user_id = ?`, [userId], (err) => { if (err) hasError = true; });

        if (ids.length > 0) {
            const stmt = db.prepare(`INSERT INTO user_schools (user_id, school_id) VALUES (?, ?)`);
            ids.forEach(id => stmt.run([userId, id], (err) => { if (err) hasError = true; }));
            stmt.finalize();
        }

        if (hasError) {
            db.run('ROLLBACK');
            res.redirect(`/admin/users/${userId}/edit`);
        } else {
            db.run('COMMIT');
            res.redirect('/admin/users');
        }
    });
});

// POST delete user
router.post('/users/:id/delete', (req, res) => {
    const userId = req.params.id;

    // Check if user has active listings
    db.get(`SELECT count(*) as count FROM listings WHERE user_id = ?`, [userId], (err, row) => {
        if (err || (row && row.count > 0)) {
            return db.all(`
                SELECT u.user_id, u.email, u.name, u.role, u.invite_token,
                GROUP_CONCAT(s.name, ', ') as school_names
                FROM users u
                LEFT JOIN user_schools us ON u.user_id = us.user_id
                LEFT JOIN schools s ON us.school_id = s.school_id
                GROUP BY u.user_id
                ORDER BY u.name ASC, u.email ASC
            `, (err, users) => {
                res.render('admin_users', { users: users || [], error: 'Benutzer hat noch Inserate und kann nicht gelöscht werden.', user: req.user });
            });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run(`DELETE FROM user_schools WHERE user_id = ?`, [userId]);
            db.run(`DELETE FROM users WHERE user_id = ?`, [userId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                } else {
                    db.run('COMMIT');
                }
                res.redirect('/admin/users');
            });
        });
    });
});

// POST reset password for a user
router.post('/users/:id/reset-password', (req, res) => {
    const userId = req.params.id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    db.run(`UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE user_id = ?`, 
        [token, expiry, userId], 
        (err) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin/users');
            }
            
            const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
            
            // Redirect back with the link in a query param or session?
            // For now, let's just re-render the users list with a success message containing the link.
            db.all(`
                SELECT u.user_id, u.email, u.name, u.role, u.invite_token,
                GROUP_CONCAT(s.name, ', ') as school_names
                FROM users u
                LEFT JOIN user_schools us ON u.user_id = us.user_id
                LEFT JOIN schools s ON us.school_id = s.school_id
                GROUP BY u.user_id
                ORDER BY u.name ASC, u.email ASC
            `, (err, users) => {
                res.render('admin_users', { 
                    users: users || [], 
                    error: null, 
                    successLink: resetLink, 
                    user: req.user 
                });
            });
    });
});

// GET manage tags
router.get('/tags', (req, res) => {
    db.all(`SELECT * FROM tags ORDER BY name ASC`, (err, tags) => {
        if (err) {
            console.error(err);
            tags = [];
        }
        res.render('admin_tags', { tags, error: null, user: req.user });
    });
});

// POST add new tag
router.post('/tags', (req, res) => {
    const { name } = req.body;
    if (!name) return res.redirect('/admin/tags');

    db.run(`INSERT INTO tags (name) VALUES (?)`, [name], (err) => {
        if (err) {
            return db.all(`SELECT * FROM tags ORDER BY name ASC`, (errTags, tags) => {
                res.render('admin_tags', { tags: tags || [], error: 'Tag existiert bereits.', user: req.user });
            });
        }
        res.redirect('/admin/tags');
    });
});

// POST delete tag
router.post('/tags/:id/delete', (req, res) => {
    const tagId = req.params.id;
    db.run(`DELETE FROM tags WHERE tag_id = ?`, [tagId], (err) => {
        if (err) {
            return db.all(`SELECT * FROM tags ORDER BY name ASC`, (errTags, tags) => {
                res.render('admin_tags', { tags: tags || [], error: 'Tag konnte nicht gelöscht werden (evtl. noch in Verwendung).', user: req.user });
            });
        }
        res.redirect('/admin/tags');
    });
});

module.exports = router;
