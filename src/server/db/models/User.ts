import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import { inMemoryStore, getDatabaseStatus } from '../connection.js';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.passwordHash);
};

export const UserModel = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

/**
 * Universal User repository supporting both MongoDB and In-Memory modes.
 */
export class UserRepository {
  static async findByEmail(email: string): Promise<any | null> {
    const { isInMemoryFallback } = getDatabaseStatus();
    if (isInMemoryFallback) {
      const normalized = email.toLowerCase().trim();
      for (const u of inMemoryStore.users.values()) {
        if (u.email.toLowerCase() === normalized) {
          return {
            ...u,
            comparePassword: async (cand: string) => bcrypt.compare(cand, u.passwordHash),
          };
        }
      }
      return null;
    }
    return UserModel.findOne({ email: email.toLowerCase().trim() });
  }

  static async findById(id: string): Promise<any | null> {
    const { isInMemoryFallback } = getDatabaseStatus();
    if (isInMemoryFallback) {
      const u = inMemoryStore.users.get(id);
      if (!u) return null;
      return {
        ...u,
        comparePassword: async (cand: string) => bcrypt.compare(cand, u.passwordHash),
      };
    }
    return UserModel.findById(id);
  }

  static async create(userData: { email: string; password: string; name: string }): Promise<any> {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(userData.password, salt);

    const { isInMemoryFallback } = getDatabaseStatus();
    if (isInMemoryFallback) {
      const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const user = {
        _id: id,
        id,
        email: userData.email.toLowerCase().trim(),
        passwordHash,
        name: userData.name,
        createdAt: new Date(),
        comparePassword: async (cand: string) => bcrypt.compare(cand, passwordHash),
      };
      inMemoryStore.users.set(id, user);
      return user;
    }

    return UserModel.create({
      email: userData.email.toLowerCase().trim(),
      passwordHash,
      name: userData.name,
    });
  }
}
