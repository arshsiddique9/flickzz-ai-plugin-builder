// scripts/parse-error.js

const fs = require('fs');

/**
 * Yeh function build.log ko padhta hai aur sirf asli errors nikalta hai.
 * Ab "symbol: class X" aur "symbol: variable X" lines bhi capture karta hai.
 */
function parseErrorLog(logPath) {
    if (!logPath || !fs.existsSync(logPath)) {
        return "No build log file found.";
    }

    const logContent = fs.readFileSync(logPath, 'utf8');
    const lines = logContent.split('\n');
    let extractedErrors = [];

    // Patterns
    const javaCompilerError = /\[ERROR\]\s+.*?\.java:\[\d+,\d+\]\s+(.*)/;
    const mavenGoalError = /\[ERROR\]\s+Failed to execute goal/;
    const symbolLine = /\[ERROR\]\s+symbol:\s+(class|variable|method|interface)\s+\w+/i;
    const locationLine = /\[ERROR\]\s+location:\s+/i;

    for (const line of lines) {
        if (javaCompilerError.test(line)) {
            extractedErrors.push(line.trim());
        } else if (mavenGoalError.test(line)) {
            extractedErrors.push(line.trim());
        } else if (symbolLine.test(line)) {
            // 🆕 "symbol: class HomeManager" type lines
            extractedErrors.push(line.trim());
        } else if (locationLine.test(line)) {
            // 🆕 "location: class ..." type lines (helpful context)
            extractedErrors.push(line.trim());
        } else if (line.includes('[ERROR]') && (
            line.includes('cannot find symbol') ||
            line.includes('incompatible types') ||
            line.includes('package does not exist')
        )) {
            extractedErrors.push(line.trim());
        }
    }

    // Fallback: agar koi specific error nahi mili, toh last ke 20 [ERROR] lines
    if (extractedErrors.length === 0) {
        extractedErrors = lines
            .filter(line => line.includes('[ERROR]'))
            .slice(-20)
            .map(line => line.trim());
    }

    if (extractedErrors.length === 0) {
        return "No specific errors found in log. Please check manually.";
    }

    // Duplicates hatao aur top 30 errors rakho
    const uniqueErrors = [...new Set(extractedErrors)].slice(0, 30);

    console.log(`[Error Parser] Found ${uniqueErrors.length} unique errors in the log.`);
    return uniqueErrors.join('\n');
}

module.exports = { parseErrorLog };
