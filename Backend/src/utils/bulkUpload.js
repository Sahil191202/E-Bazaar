import csv  from 'csv-parser';
import XLSX from 'xlsx';
import fs   from 'fs';

export const parseCSV = (filePath) =>
  new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end',  () => resolve(rows))
      .on('error', reject);
  });

export const parseExcel = (filePath) => {
  const workbook  = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet     = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
};