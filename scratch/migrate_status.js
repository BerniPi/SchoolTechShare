const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    
    // Create new table
    db.run(`
        CREATE TABLE listings_new (
            listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            school_id INTEGER,
            type TEXT CHECK(type IN ('offer', 'request')),
            title TEXT,
            description TEXT,
            status TEXT CHECK(status IN ('active', 'resolved', 'reserved')) DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users (user_id),
            FOREIGN KEY (school_id) REFERENCES schools (school_id)
        )
    `);

    // Copy data - specify columns because the order in the current table is different from the schema definition
    db.run(`
        INSERT INTO listings_new (listing_id, user_id, school_id, type, title, description, status, created_at)
        SELECT listing_id, user_id, school_id, type, title, description, status, created_at FROM listings
    `);

    // Drop old table (requires disabling foreign keys temporarily or just doing it in order)
    db.run("PRAGMA foreign_keys = OFF");
    db.run("DROP TABLE listings");
    db.run("ALTER TABLE listings_new RENAME TO listings");
    db.run("PRAGMA foreign_keys = ON");

    db.run("COMMIT", (err) => {
        if (err) console.error('Migration failed:', err.message);
        else console.log('Migration successful: listings table updated.');
    });
});

db.close();
