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

// A todo's entries: typed / voice-to-text words, or a recording (whose audio
// is the POST body)
router.post("/:id/entries", todoController.addEntry);
router.post("/:id/entries/recording", todoController.readAudio, todoController.addRecording);
router.put("/:id/entries/:entryId", todoController.updateEntry);
router.delete("/:id/entries/:entryId", todoController.removeEntry);
router.get("/:id/entries/:entryId/audio", todoController.getAudio);

module.exports = router;
