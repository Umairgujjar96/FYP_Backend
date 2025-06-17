const roleCheck = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      // Check if user exists in request (should be set by auth middleware)
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - No user session found",
        });
      }

      // Check if user's role is in the allowed roles
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden - Insufficient permissions",
        });
      }

      // If role is allowed, proceed to the next middleware/route handler
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error while checking permissions",
        error: error.message,
      });
    }
  };
};

export default roleCheck;
