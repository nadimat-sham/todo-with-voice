const express = require("express");
const router = express.Router();
const todoController = require("../controllers/todoController");

// The signed-in account's todos (requireLogin runs before this router)
router.get("/", todoController.list);
router.post("/", todoController.create);
router.put("/:id", todoController.update);

// Tick off / reopen
router.patch("/:id/done", todoController.setDone);

router.delete("/:id", todoController.remove);

// A voice todo's recording (the audio itself is the PUT body)
router.put("/:id/audio", todoController.readAudio, todoController.saveAudio);
router.get("/:id/audio", todoController.getAudio);
router.delete("/:id/audio", todoController.removeAudio);

module.exports = router;
