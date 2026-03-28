import { Router } from 'express';
import { getDatabase } from '../db/index.js';
import { attachUser, requireAuth } from '../auth/index.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validation schemas
const fileIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid file ID format');

// Apply middleware
router.use(attachUser);
router.use(requireAuth);

// GET /api/files - List current user's files
router.get('/', async (req, res) => {
  try {
    console.log('[files] GET /api/files - User ID:', req.user._id);
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    
    const files = await db.collection('files')
      .find({ userId: new ObjectId(req.user._id) })
      .sort({ createdAt: -1 })
      .project({
        userId: 0,
        storagePath: 0 // Mask internal paths from responses
      })
      .toArray();
    
    console.log('[files] Found', files.length, 'files for user');
    
    // Add download URLs and format response
    const filesWithUrls = files.map(file => {
      const now = new Date();
      const retainUntil = new Date(file.retainUntil);
      const daysRemaining = Math.max(0, Math.ceil((retainUntil - now) / (1000 * 60 * 60 * 24)));
      
      return {
        id: file._id,
        stationTitle: file.stationTitle,
        region: file.region,
        includesMoon: file.includesMoon,
        createdAt: file.createdAt,
        retainUntil: file.retainUntil,
        daysRemaining,
        lastDownloadedAt: file.lastDownloadedAt,
        downloadUrl: `${process.env.APP_URL}/api/files/${file._id}/download`
      };
    });
    
    res.json({ files: filesWithUrls });
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:id/download - Download file (auth & owner required)
router.get('/:id/download', async (req, res) => {
  try {
    // Validate file ID parameter
    const validation = fileIdSchema.safeParse(req.params.id);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid file ID', 
        details: validation.error.errors 
      });
    }
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const fileId = validation.data;
    
    // Find file and verify ownership
    const file = await db.collection('files').findOne({
      _id: new ObjectId(fileId),
      userId: new ObjectId(req.user._id)
    });
    
    if (!file) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    
    // Construct full file path (mask internal paths from responses)
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
      { _id: new ObjectId(fileId) },
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
