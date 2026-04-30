const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDb();
    }
});

function initializeDb() {
    db.serialize(() => {
        // Enable foreign keys
        db.run(`PRAGMA foreign_keys = ON`);

        // Schools Table
        db.run(`
            CREATE TABLE IF NOT EXISTS schools (
                school_id INTEGER PRIMARY KEY AUTOINCREMENT,
                school_code TEXT UNIQUE NOT NULL,
                name TEXT,
                address TEXT,
                city TEXT
            )
        `);

        // Users Table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT,
                phone_number TEXT,
                role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
                school_id INTEGER,
                invite_token TEXT UNIQUE,
                reset_token TEXT UNIQUE,
                reset_token_expiry TEXT,
                FOREIGN KEY (school_id) REFERENCES schools (school_id)
            )
        `);

        // User Schools Junction Table
        db.run(`
            CREATE TABLE IF NOT EXISTS user_schools (
                user_id INTEGER,
                school_id INTEGER,
                PRIMARY KEY (user_id, school_id),
                FOREIGN KEY (user_id) REFERENCES users (user_id),
                FOREIGN KEY (school_id) REFERENCES schools (school_id)
            )
        `);

        // Listings Table
        db.run(`
            CREATE TABLE IF NOT EXISTS listings (
                listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                school_id INTEGER,
                type TEXT CHECK(type IN ('offer', 'request')),
                title TEXT,
                description TEXT,
                status TEXT CHECK(status IN ('active', 'resolved', 'reserved')) DEFAULT 'active',
                condition TEXT,
                quantity INTEGER DEFAULT 1,
                manufacturer TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                reserved_at TEXT,
                resolved_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users (user_id),
                FOREIGN KEY (school_id) REFERENCES schools (school_id)
            )
        `);

        // Images Table
        db.run(`
            CREATE TABLE IF NOT EXISTS images (
                image_id INTEGER PRIMARY KEY AUTOINCREMENT,
                listing_id INTEGER,
                file_path TEXT,
                is_main INTEGER DEFAULT 0,
                FOREIGN KEY (listing_id) REFERENCES listings (listing_id)
            )
        `);

        // Tags Table
        db.run(`
            CREATE TABLE IF NOT EXISTS tags (
                tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE
            )
        `);

        // Listing Tags Junction Table
        db.run(`
            CREATE TABLE IF NOT EXISTS listing_tags (
                listing_id INTEGER,
                tag_id INTEGER,
                PRIMARY KEY (listing_id, tag_id),
                FOREIGN KEY (listing_id) REFERENCES listings (listing_id),
                FOREIGN KEY (tag_id) REFERENCES tags (tag_id)
            )
        `);

        // Seeding initial data is now disabled to prevent recreation of test schools
        // db.run(`INSERT OR IGNORE INTO schools (school_id, school_code, name) VALUES (1, 'SCH001', 'Test School')`);
        // db.run(`INSERT OR IGNORE INTO users (user_id, email, password_hash, name, role, school_id) VALUES (1, 'admin@test.com', '$2b$10$fxNHn1PX3JtRNqpg/BLEzuJ6WwIRIhrmpIVtCumdcS54tuHgEOeVO', 'Admin User', 'admin', 1)`);

        // Predefined tags seeding is now disabled to respect manual deletions
        /*
        const predefinedTags = [
            'Minitower', 'SFF', 'Laptop/Notebook', 'Tablet', 'Server', 'Mini-PC', 
            'Monitor', 'Tastatur/Maus', 'Drucker', 'Scanner', 'Headset/Mikrofon', 
            'Beamer/Projektor', 'Smartboard/Display', 'Dokumentenkamera', 
            'Lautsprecher', 'Switch', 'Router', 'Access Point', 'Patchpanel', 
            'Aufbewahrung', 'Kabel/Adapter', 'Festplatte', 'Arbeitsspeicher', 
            'Prozessor', 'Barebone'
        ];
        const tagStmt = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`);
        predefinedTags.forEach(tag => tagStmt.run(tag));
        tagStmt.finalize();
        */
    });
}

module.exports = {
    db,
    initializeDb
};
