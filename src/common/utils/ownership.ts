import { Types, type ClientSession, type HydratedDocument, type Model } from 'mongoose';

import { BadRequestError, NotFoundError } from '../errors';

/**
 * Ownership check (spec section 52).
 *
 * Every lookup of a user-owned document goes through here, so `userId` is part
 * of the query itself rather than something a handler has to remember to
 * compare afterwards. A document belonging to someone else is indistinguishable
 * from one that does not exist, which is also what we want: a 404 leaks nothing
 * about what other accounts contain.
 */
export async function findOwned<T>(
  model: Model<T>,
  id: string,
  userId: string,
  label: string,
  session?: ClientSession,
): Promise<HydratedDocument<T>> {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestError('That identifier is not valid.');
  }

  const document = await model
    .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) } as never)
    .session(session ?? null);

  if (!document) throw new NotFoundError(label);
  return document as HydratedDocument<T>;
}

export function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestError('That identifier is not valid.');
  return new Types.ObjectId(id);
}
