import torch.nn as nn
from transformers import BertModel

class MetaCognitiveSupervisor(nn.Module):
    def __init__(self, n_classes=1):
        super(MetaCognitiveSupervisor, self).__init__()
        self.bert = BertModel.from_pretrained('bert-base-uncased')
        self.classifier = nn.Linear(self.bert.config.hidden_size, n_classes)
        self.sigmoid = nn.Sigmoid()

    def forward(self, input_ids, attention_mask):
        outputs = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        pooled_output = outputs.pooler_output
        logits = self.classifier(pooled_output)
        return self.sigmoid(logits)