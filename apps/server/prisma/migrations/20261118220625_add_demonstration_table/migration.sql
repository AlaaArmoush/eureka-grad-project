-- CreateTable
CREATE TABLE "demonstration" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demonstration_pkey" PRIMARY KEY ("id","revision")
);

-- CreateIndex
CREATE INDEX "demonstration_topic_published_idx" ON "demonstration"("topic", "published");
