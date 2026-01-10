import os
import psycopg2
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from transformers import BertTokenizer, BertModel
from sklearn.model_selection import train_test_split
from dotenv import load_dotenv

# --- CONFIGURATION ---
MODEL_NAME = 'bert-base-uncased'
MAX_LEN = 512 # Max number of tokens BERT can handle
BATCH_SIZE = 4
EPOCHS = 3 # How many times to loop over the training data
LEARNING_RATE = 2e-5
SAVED_MODEL_NAME = 'supervisor_model.pth'

# Load environment variables from the parent directory's .env file
load_dotenv(dotenv_path='../.env') 

# --- 1. DATA LOADING ---
def fetch_training_data():
    """Connects to the Neon database and fetches user-rated interactions."""
    print("Connecting to Neon DB to fetch labeled data...")
    try:
        conn = psycopg2.connect(os.getenv("NETLIFY_DATABASE_URL"))
        query = """
            SELECT user_question, selected_rule, feedback_type 
            FROM query_logs 
            WHERE feedback_type != 'NO_FEEDBACK'
        """
        df = pd.read_sql_query(query, conn)
        conn.close()
        # Convert feedback to a binary label: 1 for GOOD, 0 for any type of FLAWED
        df['label'] = df['feedback_type'].apply(lambda x: 1 if x == 'GOOD' else 0)
        print(f"Fetched {len(df)} rated examples from the database.")
        return df
    except Exception as e:
        print(f"Database connection failed: {e}")
        return pd.DataFrame()

# --- 2. PYTORCH DATASET PREPARATION ---
class ReasoningChainDataset(Dataset):
    """Prepares the text data for BERT."""
    def __init__(self, texts, labels, tokenizer, max_len):
        self.texts = texts
        self.labels = labels
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, item):
        text = str(self.texts[item])
        label = self.labels[item]
        encoding = self.tokenizer.encode_plus(
            text,
            add_special_tokens=True,
            max_length=self.max_len,
            return_token_type_ids=False,
            padding='max_length',
            truncation=True,
            return_attention_mask=True,
            return_tensors='pt',
        )
        return {
            'input_ids': encoding['input_ids'].flatten(),
            'attention_mask': encoding['attention_mask'].flatten(),
            'labels': torch.tensor(label, dtype=torch.float)
        }

# --- 3. THE SUPERVISOR MODEL ARCHITECTURE ---
class MetaCognitiveSupervisor(nn.Module):
    def __init__(self, n_classes=1):
        super(MetaCognitiveSupervisor, self).__init__()
        self.bert = BertModel.from_pretrained(MODEL_NAME)
        self.classifier = nn.Linear(self.bert.config.hidden_size, n_classes)
        self.sigmoid = nn.Sigmoid()

    def forward(self, input_ids, attention_mask):
        outputs = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        pooled_output = outputs.pooler_output
        logits = self.classifier(pooled_output)
        return self.sigmoid(logits)

# --- 4. THE TRAINING PROCESS ---
def main():
    df = fetch_training_data()
    if df.empty or len(df) < 10:
        print(f"Not enough training data. Found {len(df)}, but need at least 10 to train. Please collect more user feedback.")
        return

    # Combine the user's question and the AI's chosen rule to represent the "reasoning chain"
    df['reasoning_chain'] = df['user_question'] + " [SEP] " + df['selected_rule']
    
    tokenizer = BertTokenizer.from_pretrained(MODEL_NAME)
    
    df_train, df_val = train_test_split(df, test_size=0.2, random_state=42)

    train_dataset = ReasoningChainDataset(df_train['reasoning_chain'].to_numpy(), df_train['label'].to_numpy(), tokenizer, MAX_LEN)
    val_dataset = ReasoningChainDataset(df_val['reasoning_chain'].to_numpy(), df_val['label'].to_numpy(), tokenizer, MAX_LEN)

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    model = MetaCognitiveSupervisor().to(device)
    
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
    loss_fn = nn.BCELoss().to(device)

    print("\n--- Starting Training Loop ---")
    for epoch in range(EPOCHS):
        model.train()
        total_loss = 0
        for batch in train_loader:
            input_ids = batch['input_ids'].to(device)
            attention_mask = batch['attention_mask'].to(device)
            labels = batch['labels'].to(device).unsqueeze(1)

            optimizer.zero_grad()
            outputs = model(input_ids, attention_mask)
            loss = loss_fn(outputs, labels)
            total_loss += loss.item()
            loss.backward()
            optimizer.step()
        
        avg_train_loss = total_loss / len(train_loader)
        print(f"Epoch {epoch + 1}/{EPOCHS} -> Training Loss: {avg_train_loss:.4f}")

    # Save the trained model's state dictionary for deployment
    torch.save(model.state_dict(), SAVED_MODEL_NAME)
    print(f"\n--- Training Complete ---")
    print(f"Model state saved to '{SAVED_MODEL_NAME}'")

if __name__ == '__main__':
    main()