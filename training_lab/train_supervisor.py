# training_lab/train_supervisor.py
import os
import psycopg2
import pandas as pd
import torch
import torch.nn as nn
from transformers import BertTokenizer, BertModel
from dotenv import load_dotenv

# Load keys from your .env file
load_dotenv('../.env') 

# 1. CONNECT TO NEON DB & FETCH DATA
def fetch_training_data():
    print("Fetching training data from Neon...")
    conn = psycopg2.connect(os.getenv("NETLIFY_DATABASE_URL"))
    
    # We only want rows where the user gave feedback (1 or -1)
    query = """
        SELECT user_question, selected_rule, user_feedback_score 
        FROM query_logs 
        WHERE user_feedback_score != 0
    """
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df

# 2. DEFINE THE PYTORCH MODEL (The Supervisor)
class UmpireSupervisor(nn.Module):
    def __init__(self):
        super(UmpireSupervisor, self).__init__()
        # We use BERT to understand the text
        self.bert = BertModel.from_pretrained('bert-base-uncased')
        # A simple layer to classify: Is this rule correct for this question?
        self.classifier = nn.Linear(768, 1) 
        self.sigmoid = nn.Sigmoid()

    def forward(self, input_ids, attention_mask):
        outputs = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        # Get the representation of the [CLS] token (sentence summary)
        cls_output = outputs.pooler_output
        # Predict probability of correctness
        prob = self.sigmoid(self.classifier(cls_output))
        return prob

# 3. TRAINING LOOP (Simplified)
def train():
    df = fetch_training_data()
    if len(df) < 10:
        print(f"Not enough data yet! You have {len(df)} rated interactions. Need at least 10.")
        return

    print(f"Training on {len(df)} examples...")
    
    # (Here is where we would tokenize the text and run the training loop)
    # This acts as a placeholder until you have data.
    print("PyTorch Environment is ready. Start collecting feedback!")

if __name__ == "__main__":
    train()