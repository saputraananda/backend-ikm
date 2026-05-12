const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { uploadKasbonProof } = require('../middleware/upload');
const ctrl = require('../controllers/kasbonController');

router.get('/my-submissions', authMiddleware, ctrl.getMySubmissions);
router.get('/:id',            authMiddleware, ctrl.getSubmissionById);
router.post('/',              authMiddleware, uploadKasbonProof.single('proof_doc'), ctrl.submitKasbon);
router.put('/:id',            authMiddleware, uploadKasbonProof.single('proof_doc'), ctrl.updateSubmission);
router.delete('/:id',         authMiddleware, ctrl.deleteSubmission);

module.exports = router;
