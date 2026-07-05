const nodemailer = require("nodemailer");
const Contact = require("../models/Contact");
const Notification = require("../models/Notification");

// @desc    Send contact message
// @route   POST /api/contact
// @access  Public
exports.sendContactMessage = async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email, and message",
      });
    }

    // Save message to database
    const contactMessage = await Contact.create({
      name,
      email,
      phone,
      subject,
      message,
    });

    // Admin notification for new contact message
    try {
      await Notification.create({
        recipientType: "admin",
        type: "contact",
        title: "New contact message received",
        message: `${String(name || "").trim()} sent a new contact message${subject ? `: ${String(subject).trim()}` : ""}`,
        referenceId: String(contactMessage._id),
        data: {
          contactId: String(contactMessage._id),
          name: String(name || "").trim(),
          email: String(email || "").trim(),
          phone: String(phone || "").trim(),
          subject: String(subject || "").trim(),
        },
      });
    } catch {
      // Best-effort only
    }

    // If email is configured, send email
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const mailOptions = {
        from: `"${name}" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        replyTo: email,
        subject: subject || "Contact Form Submission",
        text: message,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
          ${subject ? `<p><strong>Subject:</strong> ${subject}</p>` : ""}
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, "<br>")}</p>
        `,
      };

      await transporter.sendMail(mailOptions);
    }

    res.status(200).json({
      success: true,
      message: "Your message has been sent successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all contact messages (Admin only)
// @route   GET /api/contact/admin/messages
// @access  Private/Admin
exports.getAllMessages = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filter options
    const filter = {};
    if (req.query.isRead !== undefined) {
      filter.isRead = req.query.isRead === "true";
    }

    const messages = await Contact.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Contact.countDocuments(filter);
    const unreadCount = await Contact.countDocuments({ isRead: false });

    res.status(200).json({
      success: true,
      messages,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalMessages: total,
        limit,
      },
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single contact message (Admin only)
// @route   GET /api/contact/admin/messages/:id
// @access  Private/Admin
exports.getMessageById = async (req, res, next) => {
  try {
    const message = await Contact.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    res.status(200).json({
      success: true,
      message,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark message as read/unread (Admin only)
// @route   PATCH /api/contact/admin/messages/:id/read
// @access  Private/Admin
exports.toggleReadStatus = async (req, res, next) => {
  try {
    const message = await Contact.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    message.isRead = !message.isRead;
    message.readAt = message.isRead ? new Date() : null;
    await message.save();

    res.status(200).json({
      success: true,
      message,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete contact message (Admin only)
// @route   DELETE /api/contact/admin/messages/:id
// @access  Private/Admin
exports.deleteMessage = async (req, res, next) => {
  try {
    const message = await Contact.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    await message.deleteOne();

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get contact message statistics (Admin only)
// @route   GET /api/contact/admin/stats
// @access  Private/Admin
exports.getMessageStats = async (req, res, next) => {
  try {
    // Use aggregation for better performance
    const stats = await Contact.aggregate([
      {
        $facet: {
          total: [{ $count: "count" }],
          unread: [{ $match: { isRead: false } }, { $count: "count" }],
          read: [{ $match: { isRead: true } }, { $count: "count" }],
          recent: [
            {
              $match: {
                createdAt: {
                  $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              },
            },
            { $count: "count" },
          ],
        },
      },
    ]);

    const result = stats[0];

    res.status(200).json({
      success: true,
      stats: {
        total: result.total[0]?.count || 0,
        unread: result.unread[0]?.count || 0,
        read: result.read[0]?.count || 0,
        recentMessages: result.recent[0]?.count || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};
