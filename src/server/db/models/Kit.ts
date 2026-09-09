import mongoose, { Schema, Document } from 'mongoose';
import { PrepKit } from '../../../core/types/kit.js';
import { inMemoryStore, getDatabaseStatus } from '../connection.js';

export interface IKitDocument extends Document {
  userId: string;
  kit: PrepKit;
  createdAt: Date;
  updatedAt: Date;
}

const KitMongoSchema = new Schema<IKitDocument>({
  userId: { type: String, required: true, index: true },
  kit: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export const KitMongoModel = mongoose.models.Kit || mongoose.model<IKitDocument>('Kit', KitMongoSchema);

/**
 * Universal Kit repository for persistence.
 * Ensures users can read and modify only their own kits.
 */
export class KitRepository {
  static async findByIdForUser(kitId: string, userId: string): Promise<{ id: string; kit: PrepKit; userId: string; updatedAt: Date } | null> {
    const { isInMemoryFallback } = getDatabaseStatus();

    if (isInMemoryFallback) {
      const entry = inMemoryStore.kits.get(kitId);
      if (!entry || entry.userId !== userId) {
        return null;
      }
      return entry;
    }

    const doc = await KitMongoModel.findOne({ _id: kitId, userId });
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      kit: doc.kit,
      userId: doc.userId,
      updatedAt: doc.updatedAt,
    };
  }

  static async listByUser(userId: string): Promise<Array<{ id: string; kit: PrepKit; updatedAt: Date }>> {
    const { isInMemoryFallback } = getDatabaseStatus();

    if (isInMemoryFallback) {
      const results: Array<{ id: string; kit: PrepKit; updatedAt: Date }> = [];
      for (const entry of inMemoryStore.kits.values()) {
        if (entry.userId === userId) {
          results.push(entry);
        }
      }
      return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    const docs = await KitMongoModel.find({ userId }).sort({ updatedAt: -1 });
    return docs.map(d => ({
      id: d._id.toString(),
      kit: d.kit,
      updatedAt: d.updatedAt,
    }));
  }

  static async create(userId: string, kit: PrepKit): Promise<{ id: string; kit: PrepKit }> {
    const { isInMemoryFallback } = getDatabaseStatus();

    if (isInMemoryFallback) {
      const id = `kit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        id,
        _id: id,
        userId,
        kit,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      inMemoryStore.kits.set(id, entry);
      return { id, kit };
    }

    const doc = await KitMongoModel.create({
      userId,
      kit,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { id: doc._id.toString(), kit: doc.kit };
  }

  static async update(kitId: string, userId: string, kit: PrepKit): Promise<boolean> {
    const { isInMemoryFallback } = getDatabaseStatus();

    if (isInMemoryFallback) {
      const entry = inMemoryStore.kits.get(kitId);
      if (!entry || entry.userId !== userId) {
        return false;
      }
      entry.kit = kit;
      entry.updatedAt = new Date();
      inMemoryStore.kits.set(kitId, entry);
      return true;
    }

    const res = await KitMongoModel.updateOne(
      { _id: kitId, userId },
      { $set: { kit, updatedAt: new Date() } }
    );
    return res.matchedCount > 0;
  }

  static async delete(kitId: string, userId: string): Promise<boolean> {
    const { isInMemoryFallback } = getDatabaseStatus();

    if (isInMemoryFallback) {
      const entry = inMemoryStore.kits.get(kitId);
      if (!entry || entry.userId !== userId) {
        return false;
      }
      inMemoryStore.kits.delete(kitId);
      return true;
    }

    const res = await KitMongoModel.deleteOne({ _id: kitId, userId });
    return res.deletedCount > 0;
  }
}
