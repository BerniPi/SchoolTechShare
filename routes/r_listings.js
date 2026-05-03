const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../database');

// Define multer storage for listing photos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Saving to public/uploads
        const uploadDir = path.join(__dirname, '../public/uploads');
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'listing-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Configure multer middleware: maximum of 5 files named 'photos'
const upload = multer({ 
    storage: storage,
    limits: { files: 5 } 
});

// Common handler for listings
const handleListings = (req, res, forceType) => {
    const showResolved = req.query.show_resolved === 'true';
    const { q, tag, condition, manufacturer, sort, order } = req.query;
    const currentType = forceType || req.query.type;
    
    let conditions = [];
    let params = [];

    if (!showResolved) {
        conditions.push("l.status IN ('active', 'reserved')");
    }

    if (currentType) {
        conditions.push("l.type = ?");
        params.push(currentType);
    }

    if (q) {
        conditions.push("(l.title LIKE ? OR l.description LIKE ?)");
        const searchParam = `%${q}%`;
        params.push(searchParam, searchParam);
    }

    if (tag) {
        conditions.push("l.listing_id IN (SELECT lt.listing_id FROM listing_tags lt JOIN tags t ON lt.tag_id = t.tag_id WHERE t.name = ?)");
        params.push(tag);
    }

    if (condition) {
        conditions.push("l.condition = ?");
        params.push(condition);
    }

    if (manufacturer) {
        conditions.push("l.manufacturer = ?");
        params.push(manufacturer);
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // Sorting logic
    const sortMap = {
        'title': 'l.title',
        'created_at': 'l.created_at',
        'school_name': 's.name',
        'user_name': 'u.name'
    };
    const sortBy = sortMap[sort] || 'l.created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const query = `
        SELECT l.*, u.email as user_email, u.name as user_name, s.name as school_name,
        (SELECT file_path FROM images WHERE listing_id = l.listing_id ORDER BY is_main DESC, image_id ASC LIMIT 1) as cover_image
        FROM listings l
        JOIN users u ON l.user_id = u.user_id
        LEFT JOIN schools s ON l.school_id = s.school_id
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
    `;

    db.all(query, params, (err, listings) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error.');
        }

        // Also fetch all tags and unique manufacturers to display filter options
        db.all(`SELECT name FROM tags ORDER BY name ASC`, (err, allTags) => {
            if (err) allTags = [];
            db.all(`SELECT DISTINCT manufacturer FROM listings WHERE manufacturer IS NOT NULL AND manufacturer != '' ORDER BY manufacturer ASC`, (err, manufacturers) => {
                const allManufacturers = manufacturers ? manufacturers.map(m => m.manufacturer) : [];
                res.render('listings', { 
                    listings,
                    currentType,
                    activePage: currentType === 'offer' ? 'offers' : 'requests',
                    user: req.user, 
                    showResolved, 
                    q, 
                    selectedTag: tag,
                    selectedCondition: condition,
                    selectedManufacturer: manufacturer,
                    sortBy: sort || 'created_at',
                    sortOrder: order || 'desc',
                    allTags: allTags.map(t => t.name),
                    allManufacturers
                });
            });
        });
    });
};

// Routes
router.get('/', (req, res) => res.redirect('/offers'));
router.get('/offers', (req, res) => handleListings(req, res, 'offer'));
router.get('/requests', (req, res) => handleListings(req, res, 'request'));

// GET route to display the creation form
router.get('/listing/new', (req, res) => {
    const userId = req.user ? req.user.user_id : null;
    if (!userId) return res.redirect('/login');

    db.all(`
        SELECT s.* FROM schools s 
        JOIN user_schools us ON s.school_id = us.school_id 
        WHERE us.user_id = ?
    `, [userId], (err, schools) => {
        if (err) schools = [];
        db.all(`SELECT * FROM tags ORDER BY name ASC`, (err, allTags) => {
            if (err) allTags = [];
            res.render('create_listing', { schools, user: req.user, allTags, type: req.query.type });
        });
    });
});

// GET route to display a specific listing
router.get('/listing/:id', (req, res) => {
    const listingId = req.params.id;
    
    db.get(`SELECT l.*, u.email as user_email, u.name as user_name, s.name as school_name 
            FROM listings l
            JOIN users u ON l.user_id = u.user_id
            JOIN schools s ON l.school_id = s.school_id
            WHERE l.listing_id = ?`, [listingId], (err, listing) => {
        if (err || !listing) {
            return res.status(404).send('Listing not found');
        }

        db.all(`SELECT * FROM images WHERE listing_id = ? ORDER BY is_main DESC, image_id ASC`, [listingId], (err, images) => {
            if (err) images = [];
            
            db.all(`SELECT t.name FROM tags t
                    JOIN listing_tags lt ON t.tag_id = lt.tag_id
                    WHERE lt.listing_id = ?`, [listingId], (err, tags) => {
                if (err) tags = [];
                
                res.render('listing_detail', { 
                    listing, 
                    images, 
                    tags: tags.map(t => t.name),
                    user: req.user
                });
            });
        });
    });
});

// POST route to handle listing creation
router.post('/listing/new', upload.array('photos', 5), (req, res) => {
    const { type, title, description, tags, school_id, condition, quantity, manufacturer } = req.body;
    
    const userId = req.user ? req.user.user_id : 1; 

    if (!title || !type || !school_id) {
        return res.status(400).send('Title, type and school are required.');
    }

    // Execute within a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const insertListing = `INSERT INTO listings (user_id, school_id, type, title, description, status, condition, quantity, manufacturer) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`;
        
        db.run(insertListing, [userId, school_id, type, title, description, type === 'offer' ? condition : null, parseInt(quantity) || 1, manufacturer], function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error('Error inserting listing:', err);
                return res.status(500).send('Error saving listing.');
            }

            const listingId = this.lastID;
            let pendingTasks = 0;
            let hasError = false;

            // Helper to check if all async sub-inserts are done
            const checkCompletion = () => {
                if (hasError) return;
                pendingTasks--;
                if (pendingTasks <= 0) {
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            console.error('Transaction commit error:', commitErr);
                            return res.status(500).send('Database error.');
                        }
                        // Successfully committed
                        res.redirect('/listing/' + listingId);
                    });
                }
            };

            // 1. Insert Images
            if (req.files && req.files.length > 0) {
                const insertImage = `INSERT INTO images (listing_id, file_path) VALUES (?, ?)`;
                const stmt = db.prepare(insertImage);
                
                req.files.forEach(file => {
                    pendingTasks++;
                    // Save relative path (public) to DB
                    const filePath = '/uploads/' + file.filename; 
                    stmt.run([listingId, filePath], (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            db.run('ROLLBACK');
                            return res.status(500).send('Error saving images.');
                        }
                        checkCompletion();
                    });
                });
                stmt.finalize();
            }

            // 2. Insert Tags
            let tagList = [];
            if (tags) {
                tagList = Array.isArray(tags) ? tags : [tags];
            }

            if (tagList.length > 0) {
                    const insertTag = `INSERT OR IGNORE INTO tags (name) VALUES (?)`;
                    const getTagId = `SELECT tag_id FROM tags WHERE name = ?`;
                    const insertListingTag = `INSERT INTO listing_tags (listing_id, tag_id) VALUES (?, ?)`;
                    
                    const tagStmt = db.prepare(insertTag);
                    const getStmt = db.prepare(getTagId);
                    const listTagStmt = db.prepare(insertListingTag);

                    tagList.forEach(tag => {
                        pendingTasks++;
                        tagStmt.run([tag], (err) => {
                            if (err && !hasError) {
                                hasError = true;
                                db.run('ROLLBACK');
                                return res.status(500).send('Error saving tags.');
                            }
                            
                            // Retrieve the tag id (either just inserted or already existed)
                            getStmt.get([tag], (err, row) => {
                                if (err || !row) {
                                    if (!hasError) {
                                        hasError = true;
                                        db.run('ROLLBACK');
                                        return res.status(500).send('Error retrieving tag id.');
                                    }
                                    return;
                                }

                                listTagStmt.run([listingId, row.tag_id], (err) => {
                                    if (err && !hasError) {
                                        hasError = true;
                                        db.run('ROLLBACK');
                                        return res.status(500).send('Error linking tags.');
                                    }
                                    checkCompletion();
                                });
                            });
                        });
                    });
                    
                    tagStmt.finalize();
                    // getStmt and listTagStmt are used in async callbacks, so we rely on SQLite to clean them up or we can finalize them later
                }

            // If no additional items (images/tags) to insert, commit immediately
            if (pendingTasks === 0 && !hasError) {
                db.run('COMMIT');
                res.redirect('/listing/' + listingId);
            }
        });
    });
});
// GET route to edit listing
router.get('/listing/:id/edit', (req, res) => {
    const listingId = req.params.id;
    const userId = req.user ? req.user.user_id : null;
    const userRole = req.user ? req.user.role : null;

    db.get(`SELECT * FROM listings WHERE listing_id = ?`, [listingId], (err, listing) => {
        if (err || !listing) return res.status(404).send('Listing not found');

        // Check ownership or admin
        if (listing.user_id !== userId && userRole !== 'admin') {
            return res.status(403).send('Forbidden');
        }

        db.all(`SELECT * FROM images WHERE listing_id = ? ORDER BY image_id ASC`, [listingId], (err, images) => {
            if (err) images = [];
            
            db.all(`SELECT t.name FROM tags t
                    JOIN listing_tags lt ON t.tag_id = lt.tag_id
                    WHERE lt.listing_id = ?`, [listingId], (err, tags) => {
                if (err) tags = [];
                
                db.all(`SELECT * FROM tags ORDER BY name ASC`, (err, allTags) => {
                    if (err) allTags = [];
                    res.render('edit_listing', {
                        listing,
                        images,
                        tags: tags.map(t => t.name),
                        allTags,
                        user: req.user,
                        error: null
                    });
                });
            });
        });
    });
});

// POST route to edit listing
router.post('/listing/:id/edit', upload.array('photos', 5), (req, res) => {
    const listingId = req.params.id;
    const userId = req.user ? req.user.user_id : null;
    const userRole = req.user ? req.user.role : null;
    const { title, description, type, main_image_id, tags, condition, quantity, manufacturer } = req.body;
    let delete_images = req.body.delete_images || [];
    if (!Array.isArray(delete_images)) delete_images = [delete_images];

    db.get(`SELECT * FROM listings WHERE listing_id = ?`, [listingId], (err, listing) => {
        if (err || !listing) return res.status(404).send('Listing not found');

        if (listing.user_id !== userId && userRole !== 'admin') {
            return res.status(403).send('Forbidden');
        }

        db.all(`SELECT * FROM images WHERE listing_id = ?`, [listingId], (err, existingImages) => {
            if (err) return res.status(500).send('Database error');

            const newPhotosCount = req.files ? req.files.length : 0;
            const remainingImagesCount = existingImages.length - delete_images.length;
            
            if (type === 'request' && status === 'reserved') {
                return res.status(400).send('Suchen können nicht reserviert werden.');
            }

            if (remainingImagesCount + newPhotosCount > 5) {
                // If exceeded, we must delete newly uploaded files from disk to clean up
                if (req.files) {
                    req.files.forEach(f => {
                        const fp = path.join(__dirname, '../public/uploads', f.filename);
                        if (fs.existsSync(fp)) fs.unlinkSync(fp);
                    });
                }
                return res.status(400).send('Limit von 5 Fotos überschritten.');
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                let hasError = false;
                let pendingTasks = 0;

                const checkCompletion = () => {
                    if (hasError) return;
                    pendingTasks--;
                    if (pendingTasks <= 0) {
                        db.run('COMMIT', (commitErr) => {
                            if (commitErr) return res.status(500).send('Commit error');
                            res.redirect('/listing/' + listingId);
                        });
                    }
                };

                // Update text fields
                pendingTasks++;
                db.run(`UPDATE listings SET title = ?, description = ?, type = ?, condition = ?, quantity = ?, manufacturer = ? WHERE listing_id = ?`, 
                    [title, description, type, type === 'offer' ? condition : null, parseInt(quantity) || 1, manufacturer, listingId], (err) => {
                    if (err) hasError = true;
                    checkCompletion();
                });

                // Handle image deletions
                if (delete_images.length > 0) {
                    delete_images.forEach(imgId => {
                        pendingTasks++;
                        db.get(`SELECT file_path FROM images WHERE image_id = ? AND listing_id = ?`, [imgId, listingId], (err, img) => {
                            if (img) {
                                const fp = path.join(__dirname, '../public', img.file_path);
                                if (fs.existsSync(fp)) fs.unlinkSync(fp);
                                db.run(`DELETE FROM images WHERE image_id = ?`, [imgId], (err) => {
                                    if (err) hasError = true;
                                    checkCompletion();
                                });
                            } else {
                                checkCompletion();
                            }
                        });
                    });
                }

                // Handle setting main image
                pendingTasks++;
                db.run(`UPDATE images SET is_main = 0 WHERE listing_id = ?`, [listingId], (err) => {
                    if (err) hasError = true;
                    if (main_image_id && !delete_images.includes(main_image_id)) {
                        pendingTasks++;
                        db.run(`UPDATE images SET is_main = 1 WHERE image_id = ? AND listing_id = ?`, [main_image_id, listingId], (err) => {
                            if (err) hasError = true;
                            checkCompletion();
                        });
                    }
                    checkCompletion();
                });

                // Handle new images
                if (req.files && req.files.length > 0) {
                    const insertImage = `INSERT INTO images (listing_id, file_path, is_main) VALUES (?, ?, 0)`;
                    const stmt = db.prepare(insertImage);
                    req.files.forEach(file => {
                        pendingTasks++;
                        const filePath = '/uploads/' + file.filename;
                        stmt.run([listingId, filePath], (err) => {
                            if (err) hasError = true;
                            checkCompletion();
                        });
                    });
                    stmt.finalize();
                }

                // Handle tags
                pendingTasks++;
                db.run(`DELETE FROM listing_tags WHERE listing_id = ?`, [listingId], (err) => {
                    if (err) hasError = true;
                    
                    let tagList = [];
                    if (tags) {
                        tagList = Array.isArray(tags) ? tags : [tags];
                    }

                    if (tagList.length > 0) {
                            const insertTag = `INSERT OR IGNORE INTO tags (name) VALUES (?)`;
                            const getTagId = `SELECT tag_id FROM tags WHERE name = ?`;
                            const insertListingTag = `INSERT INTO listing_tags (listing_id, tag_id) VALUES (?, ?)`;
                            
                            const tagStmt = db.prepare(insertTag);
                            const getStmt = db.prepare(getTagId);
                            const listTagStmt = db.prepare(insertListingTag);

                            tagList.forEach(tag => {
                                pendingTasks++;
                                tagStmt.run([tag], (err) => {
                                    if (err) hasError = true;
                                    getStmt.get([tag], (err, row) => {
                                        if (!row) return checkCompletion();
                                        listTagStmt.run([listingId, row.tag_id], (err) => {
                                            if (err) hasError = true;
                                            checkCompletion();
                                        });
                                    });
                                });
                            });
                            tagStmt.finalize();
                        }
                        checkCompletion();
                    });
                });
            });
        });
    });

// POST delete listing
router.post('/listing/:id/delete', (req, res) => {
    const listingId = req.params.id;
    const userId = req.user ? req.user.user_id : null;
    const userRole = req.user ? req.user.role : null;

    db.get(`SELECT user_id FROM listings WHERE listing_id = ?`, [listingId], (err, listing) => {
        if (err || !listing) return res.status(404).send('Listing not found');

        if (listing.user_id !== userId && userRole !== 'admin') {
            return res.status(403).send('Forbidden');
        }

        db.all(`SELECT file_path FROM images WHERE listing_id = ?`, [listingId], (err, images) => {
            if (images) {
                images.forEach(img => {
                    const fp = path.join(__dirname, '../public', img.file_path);
                    if (fs.existsSync(fp)) fs.unlinkSync(fp);
                });
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                db.run(`DELETE FROM images WHERE listing_id = ?`, [listingId]);
                db.run(`DELETE FROM listing_tags WHERE listing_id = ?`, [listingId]);
                db.run(`DELETE FROM listings WHERE listing_id = ?`, [listingId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).send('Delete failed');
                    }
                    db.run('COMMIT', () => {
                        res.redirect('/offers');
                    });
                });
            });
        });
    });
});

// POST route to handle status changes
router.post('/listing/:id/status', (req, res) => {
    const listingId = req.params.id;
    const { status } = req.body;
    const userId = req.user ? req.user.user_id : null;
    const userRole = req.user ? req.user.role : null;

    db.get(`SELECT * FROM listings WHERE listing_id = ?`, [listingId], (err, listing) => {
        if (err || !listing) return res.status(404).send('Listing not found');

        // Check ownership or admin
        if (listing.user_id !== userId && userRole !== 'admin') {
            return res.status(403).send('Forbidden');
        }
        
        let query = "UPDATE listings SET status = ?";
        let params = [status];
        
        if (status === 'reserved') {
            query += ", reserved_at = datetime('now', 'localtime')";
        } else if (status === 'resolved') {
            query += ", resolved_at = datetime('now', 'localtime')";
        } else if (status === 'active') {
            query += ", reserved_at = NULL, resolved_at = NULL";
        }
        
        query += " WHERE listing_id = ?";
        params.push(listingId);
        
        db.run(query, params, (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }
            res.redirect('/listings/' + listingId);
        });
    });
});

module.exports = router;
