const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    // 1. Create junction table
    db.run(`
        CREATE TABLE IF NOT EXISTS user_schools (
            user_id INTEGER,
            school_id INTEGER,
            PRIMARY KEY (user_id, school_id),
            FOREIGN KEY (user_id) REFERENCES users (user_id),
            FOREIGN KEY (school_id) REFERENCES schools (school_id)
        )
    `, (err) => {
        if (err) console.error("Error creating user_schools:", err);
        else console.log("Created user_schools table.");
    });

    // 2. Migrate data from users.school_id to user_schools
    db.run(`
        INSERT OR IGNORE INTO user_schools (user_id, school_id)
        SELECT user_id, school_id FROM users WHERE school_id IS NOT NULL
    `, (err) => {
        if (err) console.error("Error migrating user schools:", err);
        else console.log("Migrated users to user_schools.");
    });

    // 3. Add school_id to listings
    db.run(`
        ALTER TABLE listings ADD COLUMN school_id INTEGER REFERENCES schools(school_id)
    `, (err) => {
        if (err && !err.message.includes("duplicate column name")) console.error("Error altering listings:", err);
        else {
            console.log("Added school_id to listings.");
            // 4. Migrate data from users.school_id to listings.school_id
            db.run(`
                UPDATE listings 
                SET school_id = (SELECT school_id FROM users WHERE users.user_id = listings.user_id)
                WHERE school_id IS NULL
            `, (err) => {
                if (err) console.error("Error migrating listings schools:", err);
                else console.log("Migrated listings schools.");
            });
        }
    });
});
