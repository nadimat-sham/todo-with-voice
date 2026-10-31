const { sessionAccount } = require("../utils/auth");

// Gate for every data API route: only a signed-in account gets through, as
// req.account. An account still on an emailed one-time password must set
// its own first, so it's refused everything else until then.
exports.requireLogin = async (req, res, next) => {
  try {
    const account = await sessionAccount(req);
    if (!account) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }
    if (account.must_change_password) {
      return res.status(403).json({ success: false, mustChangePassword: true, message: "Set your own password first" });
    }
    req.account = account;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};
