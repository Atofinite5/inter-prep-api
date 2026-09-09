import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { KitRepository } from '../db/models/Kit.js';
import { PracticeEngine } from '../../core/practice/practice_engine.js';

export const practiceRouter = Router();

// Protect all practice endpoints
practiceRouter.use(authenticateToken);

// Get prioritized practice deck and stats
practiceRouter.get('/:id/deck', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const entry = await KitRepository.findByIdForUser(req.params.id, req.user!.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found or access denied.' });
    }

    const prioritizedDeck = PracticeEngine.prioritizeDeck(entry.kit.flashcards);
    const stats = PracticeEngine.computeStats(entry.kit.flashcards, entry.kit.role.requirements);

    return res.json({
      deck: prioritizedDeck,
      stats,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// Record confidence score on a flashcard
practiceRouter.post('/:id/confidence', async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { cardId, confidence } = req.body;

    if (!cardId || ![1, 2, 3, 4, 5].includes(confidence)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'cardId and confidence (1-5) are required.' });
    }

    const entry = await KitRepository.findByIdForUser(req.params.id, req.user!.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found or access denied.' });
    }

    let updatedCard: any = null;
    const updatedFlashcards = entry.kit.flashcards.map((card: any) => {
      if (card.id !== cardId) return card;
      updatedCard = PracticeEngine.recordConfidence(card, confidence as 1 | 2 | 3 | 4 | 5);
      return updatedCard;
    });

    if (!updatedCard) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `Flashcard with id "${cardId}" not found in kit.` });
    }

    const updatedKit = {
      ...entry.kit,
      flashcards: updatedFlashcards,
    };

    await KitRepository.update(entry.id, req.user!.id, updatedKit);
    const stats = PracticeEngine.computeStats(updatedFlashcards, entry.kit.role.requirements);

    return res.json({
      message: 'Confidence recorded',
      card: updatedCard,
      stats,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});
