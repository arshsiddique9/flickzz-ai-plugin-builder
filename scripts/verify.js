// scripts/verify.js

const { verifyJar } = require('./verifier');
const path = require('path');

const jarPath = process.argv[2];

if (!jarPath) {
    console.error("❌ Usage: node scripts/verify.js <path-to-jar>");
    process.exit(1);
}

try {
    verifyJar(path.resolve(jarPath));
    console.log("✅ JAR Verification Passed!");
} catch (error) {
    console.error("❌ JAR Verification Failed:", error.message);
    process.exit(1);
}
