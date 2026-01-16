require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3002;

// System API Key from .env
const SYSTEM_GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ---------------------------------------------------------
// 🔒 SECURITY: MASTER CREDENTIALS (BACKEND ONLY)
// ---------------------------------------------------------
// Now loads from .env for Docker compatibility
const MASTER_CONFIG = {
    host: process.env.DB_HOST, 
    user: process.env.DB_USER,          
    password: process.env.DB_PASS, 
    ssl: { rejectUnauthorized: false } // Required for Cloud SQL
};

// --- CORS Configuration ---
const allowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    allowedHeaders: ['Content-Type', 'x-db-host', 'x-db-user', 'x-db-pass', 'x-db-name', 'x-db-port']
}));

app.use(express.json());

// ---------------------------------------------------------
// 🔌 HELPER: User Dynamic Connection
// ---------------------------------------------------------
async function getUserConnection(req) {
    const host = req.headers['x-db-host'];
    const user = req.headers['x-db-user'];
    const password = req.headers['x-db-pass'];
    const database = req.headers['x-db-name'];
    const port = req.headers['x-db-port'] || 3306;

    if (!host || !user || !database) {
        throw new Error('Missing database credentials in headers.');
    }

    return await mysql.createConnection({
        host, user, password, database, port,
        ssl: { rejectUnauthorized: false } 
    });
}

// ---------------------------------------------------------
// 🚀 ROUTE 1: CREATE WORKSPACE (Sign Up Logic)
// ---------------------------------------------------------
app.post('/api/create-workspace', async (req, res) => {
    const { newDbName, newPassword } = req.body;
    
    // 1. Sanitize Input
    const safeName = newDbName.replace(/[^a-zA-Z0-9_]/g, '');
    const dbName = `${safeName}`;    
    const userName = `${safeName}`; 

    let masterConn;
    try {
        // 2. Connect as ADMIN (Using env vars)
        masterConn = await mysql.createConnection(MASTER_CONFIG);

        // 3. Create Database
        await masterConn.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
        
        // 4. Create User
        await masterConn.query(`CREATE USER IF NOT EXISTS '${userName}'@'%' IDENTIFIED BY '${newPassword}'`);
        
        // 5. GRANT PERMISSIONS
        await masterConn.query(`GRANT ALL PRIVILEGES ON ${dbName}.* TO '${userName}'@'%'`);
        
        // 6. Apply Changes
        await masterConn.query(`FLUSH PRIVILEGES`);

        console.log(`✅ Created Workspace: DB=${dbName}, User=${userName}`);

        res.json({ 
            success: true, 
            message: 'Workspace created successfully!',
            credentials: {
                host: MASTER_CONFIG.host, 
                user: userName,           
                password: newPassword,    
                database: dbName,         
                port: 3306
            }
        });

    } catch (err) {
        console.error("Create Error:", err);
        res.status(500).json({ error: "Failed to create workspace. Name might be taken." });
    } finally {
        if (masterConn) masterConn.end();
    }
});

// ---------------------------------------------------------
// 🔍 ROUTE 2: GET SCHEMA (Verify Login)
// ---------------------------------------------------------
app.get('/api/schema', async (req, res) => {
    let conn;
    try {
        conn = await getUserConnection(req);
        const dbName = req.headers['x-db-name'];

        const [tables] = await conn.query(`SHOW TABLES`);
        if (!tables || tables.length === 0) return res.json({ tables: [] });

        const schema = { tables: [] };
        const tableNameKey = `Tables_in_${dbName}`;

        for (const table of tables) {
            const tableName = table[tableNameKey];
            const [columns] = await conn.query(`
                SELECT column_name as name, data_type as type,
                       (CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END) as pk
                FROM information_schema.columns 
                WHERE table_schema = ? AND table_name = ?
                ORDER BY ordinal_position;
            `, [dbName, tableName]);
            schema.tables.push({ name: tableName, columns: columns });
        }
        res.json(schema);
    } catch (err) {
        res.status(500).json({ error: "Authentication Failed: " + err.message });
    } finally {
        if (conn) conn.end();
    }
});

// ---------------------------------------------------------
// ⚡ ROUTE 3: RUN QUERY
// ---------------------------------------------------------
app.post('/api/query', async (req, res) => {
    const { sql } = req.body;
    let conn;
    try {
        conn = await getUserConnection(req);
        const [rows] = await conn.query(sql);
        const isSelect = Array.isArray(rows);
        res.json({ 
            data: isSelect ? rows : [], 
            meta: { rowsReturned: isSelect ? rows.length : rows.affectedRows } 
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    } finally {
        if (conn) conn.end();
    }
});

// ---------------------------------------------------------
// 🤖 ROUTE 4: AI GENERATION
// ---------------------------------------------------------
app.post('/api/generate-query', async (req, res) => {
    const { userInput, schema, mode, customKey } = req.body; 
    
    if (!userInput || !schema) return res.status(400).json({ error: 'Data required.' });

    const schemaString = schema.tables.map(table => `Table ${table.name}: ${table.columns.map(c => c.name).join(', ')}`).join('\n');
    const systemInstruction = `Generate valid MySQL query based on schema. Return ONLY JSON: { "sql": "...", "explanation": "..." }`;
    const fullPrompt = `${systemInstruction}\n\nSchema:\n${schemaString}\n\nUser Request: "${userInput}"`;

    try {
        if (!SYSTEM_GEMINI_API_KEY) throw new Error("Server API Key missing");
        const genAI = new GoogleGenerativeAI(SYSTEM_GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(fullPrompt);
        const rawOutput = result.response.text();
        
        let cleanJson = rawOutput.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsedResponse = JSON.parse(cleanJson);
        res.json({ sqlQuery: parsedResponse.sql, explanation: parsedResponse.explanation });

    } catch (err) {
        console.error("AI Error:", err.message);
        res.status(500).json({ error: "AI Generation Failed." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Secure Multi-User SQL Backend running on http://localhost:${PORT}`);
});