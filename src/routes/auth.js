const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Create an account — mails a one-time password (Google addresses only)
router.post("/signup", authController.signup);

// Mail a fresh one-time password to an existing account
router.post("/forgot-password", authController.forgotPassword);

// Sign in with an account's email + password
router.post("/login", authController.login);

// Sign out (clears the session cookie)
router.post("/logout", authController.logout);

// Change the login password (must be signed in; checked inside)
router.post("/change-password", authController.changePassword);

// Who is signed in right now
router.get("/session", authController.session);

module.exports = router;
