const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); // Import bcryptjs

// --- Basic Setup ---
const app = express();
const PORT = 5000;
app.use(cors());
app.use(express.json());

// --- Serve uploaded files statically ---
app.use('/uploads', express.static('uploads'));

// --- Create 'uploads' directory if it doesn't exist ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// --- MongoDB Connection ---
mongoose.connect('mongodb://localhost:27017/bharat_kyc_db')
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- User Schema ---
const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    mobile: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // This will now store the hash
    kycStatus: {
        type: String,
        default: 'Not Started',
        enum: ['Not Started', 'In Progress', 'Verified', 'Rejected']
    },
    documents: [{
        docType: String,
        filePath: String,
        uploadedAt: { type: Date, default: Date.now }
    }],
    faceScan: {
        filePath: String,
        uploadedAt: { type: Date, default: Date.now }
    },
    rejectionReason: { type: String }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// --- File Storage Configuration (Multer) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const userId = req.body.userId || 'unknown';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${userId}-${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// --- API ROUTES ---

// 1. User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, mobile, password } = req.body;
        if (!fullName || !mobile || !password) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        const existingUser = await User.findOne({ mobile });
        if (existingUser) {
            return res.status(409).json({ message: 'Mobile number already registered.' });
        }

        // --- HASH THE PASSWORD ---
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            fullName,
            mobile,
            password: hashedPassword // Save the hashed password
        });

        await newUser.save();
        res.status(201).json({ message: 'User registered successfully!' });

    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
    try {
        const { mobile, password } = req.body;
        if (!mobile || !password) {
            return res.status(400).json({ message: 'Mobile and password are required.' });
        }

        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(404).json({ message: 'User not found. Please register.' });
        }

        // --- COMPARE HASHED PASSWORD ---
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // Send back user data (without password)
        res.status(200).json({
            message: 'Login successful!',
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                kycStatus: user.kycStatus
            }
        });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// 3. Document Upload
app.post('/api/kyc/document-upload', upload.single('document'), async (req, res) => {
    try {
        const { userId, docType } = req.body;
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.documents.push({
            docType: docType,
            filePath: req.file.path
        });
        
        if (user.kycStatus === 'Not Started' || user.kycStatus === 'Rejected') {
            user.kycStatus = 'In Progress';
        }
        
        await user.save();
        res.status(200).json({ message: 'Document uploaded successfully.' });

    } catch (error) {
        console.error('Document Upload Error:', error);
        res.status(500).json({ message: 'Server error during document upload.' });
    }
});

// 4. Face Scan Upload
app.post('/api/kyc/face-scan', upload.single('face-scan'), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!req.file) {
            return res.status(400).json({ message: 'No face scan image uploaded.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.faceScan = { filePath: req.file.path };
        
        if (user.kycStatus === 'Not Started' || user.kycStatus === 'Rejected') {
            user.kycStatus = 'In Progress';
        }

        await user.save();
        res.status(200).json({ message: 'Face scan uploaded successfully.' });
    } catch (error) {
        console.error('Face Scan Upload Error:', error);
        res.status(500).json({ message: 'Server error during face scan upload.' });
    }
});

// --- ADMIN ROUTES ---

// 5. Get all users with pending KYC
app.get('/api/admin/pending-kyc', async (req, res) => {
    try {
        const pendingUsers = await User.find({ kycStatus: 'In Progress' });
        res.status(200).json(pendingUsers);
    } catch (error) {
        console.error('Admin Fetch Error:', error);
        res.status(500).json({ message: 'Server error fetching pending applications.' });
    }
});

// 6. Update a user's KYC status
app.post('/api/admin/update-kyc-status', async (req, res) => {
    try {
        const { userId, status, reason } = req.body;

        if (!userId || !status) {
            return res.status(400).json({ message: 'User ID and status are required.' });
        }

        if (!['Verified', 'Rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status value.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.kycStatus = status;
        if (status === 'Rejected') {
            user.rejectionReason = reason || 'No reason provided.';
        } else {
            user.rejectionReason = undefined;
        }

        await user.save();
        res.status(200).json({ message: `User KYC status updated to ${status}.` });

    } catch (error) {
        console.error('Update Status Error:', error);
        res.status(500).json({ message: 'Server error updating KYC status.' });
    }
});

// --- USER-FACING ROUTES ---
// 7. Get a user's current status
app.get('/api/user/status/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('kycStatus fullName rejectionReason');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Get User Status Error:", error);
        res.status(500).json({ message: "Server error fetching user status." });
    }
});

// 8. AI Help Assistant Endpoint
app.post('/api/ai/help', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ message: 'Prompt is required.' });
    }
    let reply = "I'm sorry, I don't have the answer to that. You can ask me about which documents to use, how long verification takes, or if your data is safe.";
    const lowerCasePrompt = prompt.toLowerCase();
    if (lowerCasePrompt.includes('document') || lowerCasePrompt.includes('aadhaar') || lowerCasePrompt.includes('pan')) {
        reply = "You can use your Aadhaar Card, PAN Card, Driving License, or Voter ID card. Make sure the photo is clear and all details are readable.";
    } else if (lowerCasePrompt.includes('time') || lowerCasePrompt.includes('how long') || lowerCasePrompt.includes('kitna time')) {
        reply = "After you upload everything, it usually takes our team about 24 hours to check your details. We will update the status on your app as soon as it is done.";
    } else if (lowerCasePrompt.includes('safe') || lowerCasePrompt.includes('secure') || lowerCasePrompt.includes('data')) {
        reply = "Yes, your information is very safe with us. We use strong encryption to protect your documents and photos, just like a bank does.";
    } else if (lowerCasePrompt.includes('hello') || lowerCasePrompt.includes('help') || lowerCasePrompt.includes('hi')) {
        reply = "Hello! How can I help you with your KYC today? You can ask me about documents, safety, or how long the process takes.";
    } else if (lowerCasePrompt.includes('face scan') || lowerCasePrompt.includes('photo')) {
        reply = "For the face scan, please make sure you are in a place with good light. Look directly at the camera and hold still. This helps us confirm it's really you.";
    }
    setTimeout(() => {
        res.status(200).json({ reply: reply });
    }, 1200);
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

