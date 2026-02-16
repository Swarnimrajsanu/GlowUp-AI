import { PrismaClient } from "./generated/prisma/client";
// convert this to a singleton for nextjs
export const prismaClient = new PrismaClient({} as any)
