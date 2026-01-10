import os
import torch
from flask import Flask, request, jsonify
from transformers import BertTokenizer
from model import MetaCognitiveSupervisor # Import the class from model.py

# --- 1. Initialize App and Load Models (Done once on startup) ---
print("Initializing Flask app and loading models...")
app = Flask(__name__)

# Load the tokenizer
tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')

# Load the model architecture and then load the saved weights
device = torch.device("cpu")
model = MetaCognitiveSupervisor()
model.load_state_dict(torch.load("supervisor_model.pth", map_location=device))
model.to(device)
model.eval() # Set the model to evaluation mode
print("Models loaded successfully.")

# --- 2. Define the Prediction Endpoint ---
@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()
    if not data or 'question' not in data or 'rule' not in data:
        return jsonify({"error": "Missing 'question' or 'rule' in request body"}), 400

    # Combine the inputs into a single "reasoning chain" string
    reasoning_chain = data['question'] + " [SEP] " + data['rule']
    
    # Prepare the text for the model
    encoded_review = tokenizer.encode_plus(
        reasoning_chain,
        add_special_tokens=True,
        max_length=512,
        return_token_type_ids=False,
        padding='max_length',
        truncation=True,
        return_attention_mask=True,
        return_tensors='pt',
    )

    input_ids = encoded_review['input_ids'].to(device)
    attention_mask = encoded_review['attention_mask'].to(device)

    # Get the prediction
    with torch.no_grad():
        probability = model(input_ids, attention_mask)

    # Extract the single probability value
    score = probability.item()

    return jsonify({
        "is_likely_correct": score > 0.5, # A simple boolean for easy use
        "correctness_probability": score
    })

# --- 3. Run the Server ---
if __name__ == "__main__":
    # Gunicorn will use this port. Cloud Run will manage it automatically.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))