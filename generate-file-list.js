// generate-file-list.js - UPDATED VERSION

const fs = require('fs');
const path = require('path');

console.log('Dokkan Checklist - Icon Counter Script\n');

// Function to get all webp files in a directory
function getIconFiles(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    const webpFiles = files
      .filter(file => file.endsWith('.webp'))
      .map(file => {
        const match = file.match(/^(\d+)\.webp$/);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter(num => num !== null)
      .sort((a, b) => a - b);

    return webpFiles;
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err.message);
    return [];
  }
}

// Check if directories exist
const lrDir = './images/lr/icons';
const dfeDir = './images/dfe/icons';

if (!fs.existsSync(lrDir)) {
  console.error(`Directory not found: ${lrDir}`);
  console.error('Please run this script from your repository root directory');
  process.exit(1);
}

if (!fs.existsSync(dfeDir)) {
  console.error(`Directory not found: ${dfeDir}`);
  console.error('Please run this script from your repository root directory');
  process.exit(1);
}

// Scan directories
console.log('Scanning icon directories...\n');

const lrFiles = getIconFiles(lrDir);
const dfeFiles = getIconFiles(dfeDir);

// Find the maximum number (handles gaps in numbering)
const lrMax = lrFiles.length > 0 ? Math.max(...lrFiles) : 0;
const dfeMax = dfeFiles.length > 0 ? Math.max(...dfeFiles) : 0;

// Create the output object
const iconCounts = {
  lr: lrMax,
  dfe: dfeMax,
  generated: new Date().toISOString(),
  counts: {
    lr: lrFiles.length,
    dfe: dfeFiles.length
  }
};

// Display summary
console.log('Icon Summary:');
console.log(`   LR Icons:  ${lrFiles.length} files found, highest number: ${lrMax}`);
console.log(`   DFE Icons: ${dfeFiles.length} files found, highest number: ${dfeMax}`);

// Check for gaps in numbering
const lrHasGaps = lrFiles.length !== lrMax;
const dfeHasGaps = dfeFiles.length !== dfeMax;

if (lrHasGaps || dfeHasGaps) {
  console.log('\nGaps detected in file numbering:');

  if (lrHasGaps) {
    const lrGaps = [];
    for (let i = 1; i <= lrMax; i++) {
      if (!lrFiles.includes(i)) lrGaps.push(i);
    }
    console.log(`   LR missing: ${lrGaps.slice(0, 10).join(', ')}${lrGaps.length > 10 ? '...' : ''} (${lrGaps.length} total)`);
  }

  if (dfeHasGaps) {
    const dfeGaps = [];
    for (let i = 1; i <= dfeMax; i++) {
      if (!dfeFiles.includes(i)) dfeGaps.push(i);
    }
    console.log(`   DFE missing: ${dfeGaps.slice(0, 10).join(', ')}${dfeGaps.length > 10 ? '...' : ''} (${dfeGaps.length} total)`);
  }
}

// Ensure js directory exists
const jsDir = './js';
if (!fs.existsSync(jsDir)) {
  fs.mkdirSync(jsDir, { recursive: true });
  console.log('\nCreated js directory');
}

// Write the JSON file
const outputPath = './js/iconCounts.json';
fs.writeFileSync(outputPath, JSON.stringify(iconCounts, null, 2));
console.log(`\nSuccessfully wrote icon counts to: ${outputPath}`);

// UPDATE FALLBACK VALUES IN SCRIPTS.JS
console.log('\nUpdating fallback values in scripts.js...');

try {
  const scriptsPath = './js/scripts.js';

  if (!fs.existsSync(scriptsPath)) {
    console.error('scripts.js not found at', scriptsPath);
  } else {
    // Read the scripts.js file
    let scriptsContent = fs.readFileSync(scriptsPath, 'utf8');

    // Create the regex pattern to match the line
    const fallbackLineRegex = /let iconCounts = \{ lr: \d+, dfe: \d+ \}; \/\/ Default fallback values/;

    // Check if the pattern exists
    if (fallbackLineRegex.test(scriptsContent)) {
      // Replace with new values
      const newLine = `let iconCounts = { lr: ${lrMax}, dfe: ${dfeMax} }; // Default fallback values`;
      scriptsContent = scriptsContent.replace(fallbackLineRegex, newLine);

      // Write back to file
      fs.writeFileSync(scriptsPath, scriptsContent);
      console.log(`Updated fallback values in scripts.js to: lr: ${lrMax}, dfe: ${dfeMax}`);
    } else {
      console.log('Could not find fallback values line in scripts.js');
      console.log('   Make sure line 2 contains: let iconCounts = { lr: XXX, dfe: XXX }; // Default fallback values');
    }
  }
} catch (error) {
  console.error('Error updating scripts.js:', error.message);
  console.log('   The icon counts JSON was still created successfully.');
}

// Show what was written
console.log('\niconCounts.json contents:');
console.log(JSON.stringify(iconCounts, null, 2));
