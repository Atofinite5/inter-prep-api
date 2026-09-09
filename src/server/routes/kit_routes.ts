import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { KitRepository } from '../db/models/Kit.js';
import { PrepKitOrchestrator, PipelineProgressEvent } from '../../core/pipeline/orchestrator.js';
import { KitStateManager } from '../../core/builder/state_manager.js';
import { validatePrepKit } from '../../core/validation/schemas.js';
import { ResilientLLMClient } from '../../core/generation/llm_client.js';

export const kitRouter = Router();

// Protect all kit endpoints
kitRouter.use(authenticateToken);

// List user's kits
kitRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const kits = await KitRepository.listByUser(req.user!.id);
    return res.json({ kits });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Get single kit
kitRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const entry = await KitRepository.findByIdForUser(req.params.id, req.user!.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Prep kit not found or access denied.' });
    }
    return res.json({ id: entry.id, kit: entry.kit, updatedAt: entry.updatedAt });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Generate new kit (Single or Streaming SSE)
kitRouter.post('/generate', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const { jd, companyUrl, days, companyName, location } = req.body;
  const isStreaming = req.query.stream === 'true';

  if (!jd || typeof jd !== 'string' || !jd.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Job description text is required.' });
  }

  if (!companyUrl || typeof companyUrl !== 'string' || !companyUrl.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Company website URL is required.' });
  }

  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 90) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Days available must be an integer between 1 and 90.' });
  }

  const orchestrator = new PrepKitOrchestrator(new ResilientLLMClient());

  if (isStreaming) {
    // Set up Server-Sent Events headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: PipelineProgressEvent | { type: string; data: any }) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const kit = await orchestrator.generateKit(
        {
          jd: jd.trim(),
          companyUrl: companyUrl.trim(),
          days: daysNum,
          companyName,
          location,
        },
        {
          onProgress: progress => sendEvent(progress),
        }
      );

      const saved = await KitRepository.create(req.user!.id, kit);
      sendEvent({ type: 'complete', data: { id: saved.id, kit: saved.kit } });
      res.end();
      return;
    } catch (err: any) {
      sendEvent({ type: 'error', data: { message: err.message || 'Generation failed' } });
      res.end();
      return;
    }
  }

  // Standard JSON response
  try {
    const kit = await orchestrator.generateKit({
      jd: jd.trim(),
      companyUrl: companyUrl.trim(),
      days: daysNum,
      companyName,
      location,
    });

    const saved = await KitRepository.create(req.user!.id, kit);
    return res.status(201).json({
      message: 'Kit generated successfully',
      id: saved.id,
      kit: saved.kit,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'GENERATION_FAILED',
      message: err.message || 'Failed to generate prep kit.',
    });
  }
});

// Update kit inline (from The Builder)
kitRouter.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { kit } = req.body;
    if (!kit) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Kit data is required.' });
    }

    const validation = validatePrepKit(kit);
    if (!validation.success) {
      return res.status(400).json({
        error: 'SCHEMA_VALIDATION_ERROR',
        message: 'Invalid kit schema according to Appendix A',
        details: validation.errors,
      });
    }

    const success = await KitRepository.update(req.params.id, req.user!.id, validation.data);
    if (!success) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found or access denied.' });
    }

    return res.json({ message: 'Kit updated successfully', kit: validation.data });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Regenerate single section preserving user edits
kitRouter.post('/:id/regenerate', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { target } = req.body;
    if (!target) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Regeneration target is required.' });
    }

    const entry = await KitRepository.findByIdForUser(req.params.id, req.user!.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found or access denied.' });
    }

    const updatedKit = await KitStateManager.regenerateSection(entry.kit, target, {
      llmClient: new ResilientLLMClient(),
    });

    await KitRepository.update(req.params.id, req.user!.id, updatedKit);
    return res.json({ message: `Section "${target}" regenerated successfully. User edits preserved.`, kit: updatedKit });
  } catch (err: any) {
    return res.status(500).json({ error: 'REGENERATION_FAILED', message: err.message });
  }
});

// Delete kit
kitRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const success = await KitRepository.delete(req.params.id, req.user!.id);
    if (!success) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found or access denied.' });
    }
    return res.json({ message: 'Kit deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});
