import { GenerateImage, GenerateImagesFromPack, TrainModel } from "@/packages/common/type";
import { prismaClient } from "@/packages/db";
import express from "express";

const PORT = process.env.PORT || 8080;
const falAiModel = new FalAIModel();

const IMAGE_GEN_CREDITS = 1;
const TRAIN_MODEL_CREDITS = 20;

const app = express();

app.use(express.json());
app.post("/ai/training", async (req, res) => {
    try {
        const parsedBody = TrainModel.safeParse(req.body);
        if (!parsedBody.success) {
          res.status(411).json({
            message: "Input incorrect",
            error: parsedBody.error,
          });
          return;
        }
    
        const { request_id, response_url } = await falAiModel.trainModel(
          parsedBody.data.zipUrl,
          parsedBody.data.name
        );
    
        const data = await prismaClient.model.create({
          data: {
            name: parsedBody.data.name,
            type: parsedBody.data.type,
            age: parsedBody.data.age,
            ethinicity: parsedBody.data.ethinicity,
            eyeColor: parsedBody.data.eyeColor,
            bald: parsedBody.data.bald,
            userId: req.userId!,
            zipUrl: parsedBody.data.zipUrl,
            falAiRequestId: request_id,
          },
        });
    
        res.json({
          modelId: data.id,
        });
      } catch (error) {
        console.error("Error in /ai/training:", error);
        res.status(500).json({
          message: "Training failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
    

app.post("/ai/generate", async (req, res) => {
    const parsedBody = GenerateImage.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(411).json({});
    return;
  }

  const model = await prismaClient.model.findUnique({
    where: {
      id: parsedBody.data.modelId,
    },
  });

  if (!model || !model.tensorPath) {
    res.status(411).json({
      message: "Model not found",
    });
    return;
  }
  // check if the user has enough credits
  const credits = await prismaClient.userCredit.findUnique({
    where: {
      userId: req.userId!,
    },
  });

  if ((credits?.amount ?? 0) < IMAGE_GEN_CREDITS) {
    res.status(411).json({
      message: "Not enough credits",
    });
    return;
  }

  const { request_id, response_url } = await falAiModel.generateImage(
    parsedBody.data.prompt,
    model.tensorPath
  );

  const data = await prismaClient.outputImages.create({
    data: {
      prompt: parsedBody.data.prompt,
      userId: req.userId!,
      modelId: parsedBody.data.modelId,
      imageUrl: "",
      falAiRequestId: request_id,
    },
  });

  await prismaClient.userCredit.update({
    where: {
      userId: req.userId!,
    },
    data: {
      amount: { decrement: IMAGE_GEN_CREDITS },
    },
  });

  res.json({
    imageId: data.id,
  });
});

app.post("/pack/generate", async (req, res) => {
    const parsedBody = GenerateImagesFromPack.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(411).json({
      message: "Input incorrect",
    });
    return;
  }

  const prompts = await prismaClient.packPrompts.findMany({
    where: {
      packId: parsedBody.data.packId,
    },
  });

  const model = await prismaClient.model.findFirst({
    where: {
      id: parsedBody.data.modelId,
    },
  });

  if (!model) {
    res.status(411).json({
      message: "Model not found",
    });
    return;
  }

  // check if the user has enough credits
  const credits = await prismaClient.userCredit.findUnique({
    where: {
      userId: req.userId!,
    },
  });

  if ((credits?.amount ?? 0) < IMAGE_GEN_CREDITS * prompts.length) {
    res.status(411).json({
      message: "Not enough credits",
    });
    return;
  }

  const requestIds = await Promise.all(
    prompts.map((prompt) =>
      falAiModel.generateImage(prompt.prompt, model.tensorPath!)
    )
  );

  const images = await prismaClient.outputImages.createManyAndReturn({
    data: prompts.map((prompt, index) => {
      const requestId = requestIds[index];
      if (!requestId) {
        throw new Error(`Request ID not found for prompt at index ${index}`);
      }
      return {
        prompt: prompt.prompt,
        userId: req.userId!,
        modelId: parsedBody.data.modelId,
        imageUrl: "",
        falAiRequestId: requestId.request_id,
      };
    }),
  });

  await prismaClient.userCredit.update({
    where: {
      userId: req.userId!,
    },
    data: {
      amount: { decrement: IMAGE_GEN_CREDITS * prompts.length },
    },
  });

  res.json({
    images: images.map((image) => image.id),
  });
});


app.get("/pack/bulk", async (req, res) => {
    const packs = await prismaClient.packs.findMany({});

    res.json({
      packs,
    });
  });
  

app.get("/image/bulk", async (req, res) => {
    const ids = req.query.ids as string[];
  const limit = (req.query.limit as string) ?? "100";
  const offset = (req.query.offset as string) ?? "0";

  const imagesData = await prismaClient.outputImages.findMany({
    where: {
      id: { in: ids },
      userId: req.userId!,
      status: {
        not: "Failed",
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: parseInt(offset),
    take: parseInt(limit),
  });

  res.json({
    images: imagesData,
  });
});





app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});