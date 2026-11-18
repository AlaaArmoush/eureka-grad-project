-- CreateTable
CREATE TABLE "challenge" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_pkey" PRIMARY KEY ("id","revision")
);

-- CreateIndex
CREATE INDEX "challenge_topic_published_idx" ON "challenge"("topic", "published");
