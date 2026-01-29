import { prisma } from "./src";

async function main() {
  const email = "21102134@usc.edu.ph";
  const role = "VP_FINANCE";

  console.log(`Checking if user ${email} exists...`);

  const existingUser = await prisma.authorizedUser.findUnique({
    where: { email },
  });

  if (existingUser) {
    console.log(`User ${email} already exists with role: ${existingUser.role}`);
    
    if (existingUser.role !== role) {
      console.log(`Updating role to ${role}...`);
      await prisma.authorizedUser.update({
        where: { email },
        data: { role },
      });
      console.log("Role updated successfully.");
    }
  } else {
    console.log(`Creating user ${email} with role ${role}...`);
    await prisma.authorizedUser.create({
      data: {
        email,
        role,
      },
    });
    console.log("User created successfully.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
