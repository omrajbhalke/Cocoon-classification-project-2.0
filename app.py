# SilkSense AI — Flask Backend
# Run: python app.py
# Install: pip install flask flask-cors ultralytics timm torch torchvision opencv-python pillow numpy scikit-learn joblib

# python app.py
# python -m http.server 3000

from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from ultralytics import YOLO
from torchvision import transforms
from PIL import Image
import torch, os, uuid, cv2
import timm
import numpy as np
import traceback
import joblib

# ── Config ────────────────────────────────────
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# ── Load Models ───────────────────────────────
print("=" * 55)
print("SilkSense AI — Loading Models")
print("=" * 55)

# YOLO segmentation model
print("Loading YOLO segmentation model...")
try:
    yolo = YOLO('best_seg.pt')
    print("✓ YOLO model loaded (best_seg.pt)")
except Exception as e:
    print("✗ Failed to load YOLO model:", e)
    yolo = None

# EfficientNet classification model
print("Loading EfficientNet classifier...")
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"  Device: {device}")

try:
    clf = timm.create_model('efficientnet_b0', pretrained=False, num_classes=2)
    clf.load_state_dict(torch.load('best_classifier.pth', map_location=device))
    clf.to(device).eval()
    print("✓ EfficientNet classifier loaded (best_classifier.pth)")
except Exception as e:
    print("✗ Failed to load EfficientNet classifier:", e)
    clf = None

# Renditta polynomial transform model
print("Loading Renditta poly transform...")
try:
    poly_transform = joblib.load('poly_transform.pkl')
    print("✓ Poly transform loaded (poly_transform.pkl)")
except Exception as e:
    print("✗ Failed to load poly transform:", e)
    poly_transform = None

# Renditta regression model
print("Loading Renditta regression model...")
try:
    renditta_model = joblib.load('best_model.pkl')
    print("✓ Renditta model loaded (best_model.pkl)")
except Exception as e:
    print("✗ Failed to load renditta model:", e)
    renditta_model = None

# Image preprocessing pipeline
preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

print("=" * 55)


# ── Core Processing ───────────────────────────
def process_image(image):
    """Run YOLO segmentation + EfficientNet classification on a PIL image."""
    if yolo is None:
        raise Exception("YOLO model not loaded")
    if clf is None:
        raise Exception("Classifier model not loaded")

    orig = np.array(image)
    bgr  = cv2.cvtColor(orig, cv2.COLOR_RGB2BGR)

    print("  Running YOLO detection...")
    results = yolo(bgr)[0]
    boxes = results.boxes.xyxy.cpu().int().tolist() if results.boxes else []

    total = len(boxes)
    qualified = 0
    print(f"  Found {total} detections")

    for i, (x1, y1, x2, y2) in enumerate(boxes):
        crop = bgr[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        try:
            crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            crop_pil = Image.fromarray(crop_rgb)
            inp      = preprocess(crop_pil).unsqueeze(0).to(device)

            with torch.no_grad():
                logits = clf(inp)
            prob  = torch.softmax(logits, dim=1)[0, 1].item()
            label = 1 if prob > 0.5 else 0
            qualified += label

            color      = (0, 255, 0) if label == 1 else (0, 0, 255)
            label_text = f"{'OK' if label == 1 else 'Defect'} {prob:.2f}"
            cv2.rectangle(orig, (x1, y1), (x2, y2), color, 4)
            cv2.putText(orig, label_text, (x1, y1 - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        except Exception as e:
            print(f"  Crop {i+1} error: {e}")

    defect          = total - qualified
    qualified_pct   = (qualified / total * 100) if total > 0 else 0.0
    defect_pct      = (defect   / total * 100) if total > 0 else 0.0

    def get_grade(q):
        return 'A' if q >= 70 else ('B' if q >= 50 else 'C')

    grade = get_grade(qualified_pct)

    stats = {
        "Total Detections":     total,
        "Qualified Cocoon Count": qualified,
        "Defect Count":         defect,
        "Qualified Cocoon %":   round(qualified_pct, 2),
        "Defect %":             round(defect_pct, 2),
        "Sample Grade":         grade
    }

    annotated_img = cv2.cvtColor(orig, cv2.COLOR_BGR2RGB)
    return Image.fromarray(annotated_img), stats


def predict_renditta(defect_pct):
    """Predict renditta using poly_transform + best_model (Polynomial Regression Degree 2)."""
    if renditta_model is None or poly_transform is None:
        raise Exception(
            "Renditta ML model not loaded. "
            "Ensure best_model.pkl and poly_transform.pkl are in the project folder."
        )
    X = np.array([[defect_pct]])
    X_poly = poly_transform.transform(X)
    renditta = float(renditta_model.predict(X_poly)[0])
    return round(renditta, 4)


# ── Routes ────────────────────────────────────

@app.route('/classify', methods=['POST'])
def classify_cocoon():
    print("\n" + "=" * 55)
    print("New classification request")

    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    file = request.files['image']
    if file.filename == '':
        return jsonify({"error": "No image selected"}), 400

    filename   = f"{uuid.uuid4().hex}.jpg"
    image_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    try:
        file.save(image_path)
        print(f"  Saved upload: {filename}")
    except Exception as e:
        return jsonify({"error": f"Failed to save image: {str(e)}"}), 500

    try:
        image = Image.open(image_path).convert('RGB')
        print(f"  Image size: {image.size}")

        annotated_image, stats = process_image(image)

        result_filename = 'result_' + filename
        result_path     = os.path.join(app.config['UPLOAD_FOLDER'], result_filename)
        annotated_image.save(result_path)
        print(f"  Result saved: {result_filename}")

        print(f"  Stats: {stats}")
        print("=" * 55)

        return jsonify({
            "image_url": f"/uploads/{result_filename}",
            "stats": stats
        })

    except Exception as e:
        traceback.print_exc()
        try:
            if os.path.exists(image_path):
                os.remove(image_path)
        except:
            pass
        return jsonify({"error": f"Processing failed: {str(e)}"}), 500


@app.route('/yield', methods=['POST'])
def estimate_yield():
    """
    Estimate silk yield using the trained Polynomial Regression renditta model.
    Expects JSON: { "defect_pct": float, "cocoon_weight_kg": float, "moisture_pct": float }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400

    defect_pct    = float(data.get('defect_pct', 0))
    cocoon_weight = float(data.get('cocoon_weight_kg', 0))
    moisture_pct  = float(data.get('moisture_pct', 0))

    if cocoon_weight <= 0:
        return jsonify({"error": "Cocoon weight must be greater than 0"}), 400
    if not (0 <= defect_pct <= 100):
        return jsonify({"error": "Defect percentage must be between 0 and 100"}), 400
    if not (10 <= moisture_pct <= 25):
        return jsonify({"error": "Moisture must be between 10% and 25%"}), 400

    try:
        renditta = predict_renditta(defect_pct)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Moisture-adjusted effective weight
    effective_weight = cocoon_weight * (1 - moisture_pct / 100)

    silk_kg  = effective_weight / renditta
    ratio    = (silk_kg / cocoon_weight) * 100
    qual_pct = 100 - defect_pct
    grade    = 'A' if qual_pct >= 70 else ('B' if qual_pct >= 50 else 'C')

    # Improvement potential at 5% defect
    improvement = 0
    if defect_pct > 5:
        try:
            best_renditta = predict_renditta(5)
            best_silk     = effective_weight / best_renditta
            improvement   = round(best_silk - silk_kg, 3)
        except:
            pass

    return jsonify({
        "renditta":              renditta,
        "effective_weight_kg":   round(effective_weight, 3),
        "silk_produced_kg":      round(silk_kg, 3),
        "silk_yield_ratio_pct":  round(ratio, 2),
        "grade":                 grade,
        "improvement_kg":        improvement,
    })


@app.route('/uploads/<filename>')
def send_uploaded_file(filename):
    try:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not os.path.exists(file_path):
            return jsonify({"error": "File not found"}), 404
        response = send_file(file_path, mimetype='image/jpeg')
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/status')
def status():
    return jsonify({
        "yolo_loaded":       yolo is not None,
        "classifier_loaded": clf is not None,
        "renditta_model":    renditta_model is not None,
        "poly_transform":    poly_transform is not None,
        "device":            str(device),
    })


@app.route('/ping')
def ping():
    return jsonify({"status": "ok", "message": "SilkSense AI backend is alive"})


if __name__ == '__main__':
    print("\nStarting SilkSense AI Backend...")
    print(f"Upload folder : {os.path.abspath(UPLOAD_FOLDER)}")
    print(f"YOLO          : {'✓' if yolo else '✗'}")
    print(f"Classifier    : {'✓' if clf else '✗'}")
    print(f"Renditta model: {'✓' if renditta_model else '✗'}")
    print(f"Poly transform: {'✓' if poly_transform else '✗'}")
    print(f"Device        : {device}")
    print("\nServer → http://127.0.0.1:5000\n")
    app.run(debug=True, host='127.0.0.1', port=5000)