const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const inbounds = await prisma.inbound.findMany();
  console.log("INBOUNDS:");
  for (const i of inbounds) {
     console.log(`Port: ${i.port}, Server Address: ${i.serverAddress}, Listen: ${i.settings?.listen}`);
  }
}
run().catch(console.error).finally(() => prisma.$disconnect());
