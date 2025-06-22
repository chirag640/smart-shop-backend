// Temp file to test the specific problematic section
const PDFDocument = require('pdfkit');

const testFunction = () => {
  const doc = new PDFDocument();
  const colors = { primary: '#6366f1' };
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  
  // Test the exact syntax that's causing issues
  doc.save()
     .fillOpacity(0.02)
     .fillColor(colors.primary)
     .fontSize(40)
     .font('Helvetica-Bold')
     .text('SMART SHOP', pageWidth/2 - 80, pageHeight/2 - 20, {
       rotate: -45,
       origin: [pageWidth/2, pageHeight/2]
     })
     .restore();
};

console.log('Syntax test completed');
