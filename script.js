window.addEventListener('DOMContentLoaded', checkForURLParameters);

document.getElementById('askButton').addEventListener('click', askQuestion);
document.getElementById('questionInput').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
});

async function askQuestion() {
    const questionInput = document.getElementById('questionInput');
    const ruleSetSelect = document.getElementById('ruleSetSelect');
    const question = questionInput.value;
    const ruleSet = ruleSetSelect.value;
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');
    const shareButton = document.getElementById('shareButton');

    if (!question) {
        alert("Please enter a question.");
        return;
    }

    answerEl.innerHTML = 'Consulting the expert...';
    button.disabled = true;
    shareButton.disabled = true; // Ensure share button is disabled during new question

    try {
        const response = await fetch('/api/ask-gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question, ruleSet: ruleSet })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        answerEl.innerHTML = marked.parse(data.answer);
        activateShareButton(question, ruleSet); // Activate the button after getting an answer

    } catch (error) {
        console.error("Error asking question:", error);
        answerEl.textContent = 'Sorry, an error occurred. Please try again.';
    } finally {
        button.disabled = false;
    }
}

// This function now enables the button and gives it the correct link
function activateShareButton(question, ruleSet) {
    const shareButton = document.getElementById('shareButton');
    const encodedQuestion = encodeURIComponent(question);
    const shareUrl = `${window.location.origin}${window.location.pathname}?ruleset=${ruleSet}&question=${encodedQuestion}`;
    
    shareButton.disabled = false; // Make the button clickable

    shareButton.onclick = function() {
        if (navigator.share) {
            navigator.share({
                title: 'RoboUmp AI Answer',
                text: `Here's the answer to "${question}":`,
                url: shareUrl,
            });
        } else {
            navigator.clipboard.writeText(shareUrl).then(function() {
                shareButton.textContent = 'Link Copied!';
                setTimeout(() => {
                    shareButton.textContent = 'Share';
                }, 2000);
            });
        }
    };
}

function checkForURLParameters() {
    const params = new URLSearchParams(window.location.search);
    const question = params.get('question');
    const ruleSet = params.get('ruleset');

    if (question && ruleSet) {
        document.getElementById('questionInput').value = decodeURIComponent(question);
        document.getElementById('ruleSetSelect').value = ruleSet;
        askQuestion();
    }
}

function trackSponsorClick() {
  if (typeof gtag === 'function') {
    gtag('event', 'click', {
      'event_category': 'sponsorship',
      'event_label': 'Contact Banner'
    });
  }
}