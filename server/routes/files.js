import { Router } from 'express';
import { getDatabase } from '../db/index.js';
import { attachUser, requireAuth } from '../auth/index.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Apply middleware
router.use(attachUser);
router.use(requireAuth);

// GET /api/files - List current user's files
router.get('/', async (req, res) => {
  try {
    const db = getDatabase();
    
    const files = await db.collection('files')
      .find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .project({
        userId: 0,
        storagePath: 0
      })
      .toArray();
    
    // Add download URLs
    const filesWithUrls = files.map(file => ({
      ...file,
      downloadUrl: `${process.env.APP_URL}/api/files/${file._id}/download`
    }));
    
    res.json({ files: filesWithUrls });
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:id/download - Download file (auth & owner required)
router.get('/:id/download', async (req, res) => {
  try {
    const db = getDatabase();
    const fileId = req.params.id;
    
    // Find file and verify ownership
    const file = await db.collection('files').findOne({
      _id: fileId,
      userId: req.user._id
    });
    
    if (!file) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    
    // Construct full file path
    const filePath = path.join(__dirname, '../../', file.storagePath);
    
    // Check if file exists on disk
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error('File not found on disk:', filePath);
      return res.status(404).json({ error: 'File not available' });
    }
    
    // Update last downloaded timestamp
    await db.collection('files').updateOne(
      { _id: fileId },
      { $set: { lastDownloadedAt: new Date() } }
    );
    
    // Set headers for file download
    const fileName = `${file.stationTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // Stream the file
    const fileContent = await fs.readFile(filePath, 'utf8');
    res.send(fileContent);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
