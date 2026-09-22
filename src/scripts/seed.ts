/**
 * Seed a demo account.
 *
 *   npm run seed
 *
 * Creates (or reuses) demo@lifely.app and fills it with a believable fortnight
 * of history, so a fresh Atlas cluster has something to look at. The history
 * itself is built by `seedDemoData`, which the app's "load sample data" also
 * calls — one definition of the demo week, not two.
 */
import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import * as authService from '@/modules/auth/auth.service';
import * as credits from '@/modules/credits/credits.service';
import { seedDemoData } from '@/modules/users/demoData';
import { User } from '@/modules/users/user.model';

const EMAIL = 'demo@lifely.app';
const PASSWORD = 'demo-password-1234';

async function main(): Promise<void> {
  await connectDatabase();

  await User.deleteOne({ email: EMAIL });
  const { user } = await authService.register({ email: EMAIL, password: PASSWORD, name: 'Karthik' });
  const userId = String((user as unknown as { id?: string; _id: string }).id ?? user._id);

  await seedDemoData(userId);

  const summary = await credits.getSummary(userId);

  logger.info(
    { email: EMAIL, password: PASSWORD, balance: summary.balance, lifetime: summary.lifetime },
    'Seeded the demo account',
  );

  await disconnectDatabase();
}

main().catch(async (error) => {
  logger.fatal({ err: error }, 'Seeding failed');
  await disconnectDatabase();
  process.exit(1);
});
