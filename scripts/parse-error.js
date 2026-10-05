// scripts/parse-error.js

const fs = require('fs');

/**
 * Yeh function build.log ko padhta hai aur sirf asli errors nikalta hai.
 * Isse AI ko bhejne ke liye clean data milta hai.
 */
function parseErrorLog(logPath) {
    if (!logPath || !fs.existsSync(logPath)) {
        return "No build log file found.";
    }

    const logContent = fs.readFileSync(logPath, 'utf8');
    const lines = logContent.split('\n');
    let extractedErrors = [];

    // Regex patterns for common Java/Maven errors
    const javaCompilerError = /\[ERROR\]\s+.*?\.java:\[\d+,\d+\]\s+(.*)/;
    const mavenGoalError = /\[ERROR\]\s+Failed to execute goal/;

    for (const line of lines) {
        if (javaCompilerError.test(line)) {
            // Yeh line actual Java error hai (jaise "cannot find symbol")
            extractedErrors.push(line.trim());
        } else if (mavenGoalError.test(line)) {
            // Yeh line Maven goal failure hai (jaise "Compilation failure")
            extractedErrors.push(line.trim());
        } else if (line.includes('[ERROR]') && (line.includes('cannot find symbol') || line.includes('incompatible types') || line.includes('package does not exist'))) {
            // Yeh specific common errors ke liye catch-all hai
            extractedErrors.push(line.trim());
        }
    }

    // Agar koi specific error nahi mili, toh last ke 15 error lines utha lo
    if (extractedErrors.length === 0) {
        extractedErrors = lines
            .filter(line => line.includes('[ERROR]'))
            .slice(-15)
            .map(line => line.trim());
    }

    if (extractedErrors.length === 0) {
        return "No specific errors found in log. Please check manually.";
    }

    // Duplicate errors hata do aur sirf top 20 errors rakho
    const uniqueErrors = [...new Set(extractedErrors)].slice(0, 20);
    
    console.log(`[Error Parser] Found ${uniqueErrors.length} unique errors in the log.`);
    return uniqueErrors.join('\n');
}

module.exports = { parseErrorLog };
