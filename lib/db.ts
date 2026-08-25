import {PrismaClient} from '@prisma/client';
const globalForPrisma=globalThis as unknown as {prisma?:PrismaClient};
export const db=globalForPrisma.prisma??new PrismaClient();
if(process.env.NODE_ENV!=='production') globalForPrisma.prisma=db;
export async function ownerUser(){return db.user.upsert({where:{id:'owner'},update:{},create:{id:'owner'}})}
