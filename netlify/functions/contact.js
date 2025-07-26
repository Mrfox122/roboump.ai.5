//contact.js

document.getElementById("contactForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const message = document.getElementById("message").value;
    const formStatus = document.getElementById("formStatus");

    formStatus.textContent = "Verifying...";

    try {
        const token = await grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', { action: 'submit' });

        console.log("reCAPTCHA token received:", token);

        const res = await fetch("/.netlify/functions/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, message, token })
        });

        const data = await res.text();

        console.log("Response from server:", data);

        if (res.ok) {
            formStatus.textContent = "Message sent successfully!";
        } else {
            formStatus.textContent = "Error: " + data;
        }
    } catch (error) {
        console.error("Client-side error:", error);
        formStatus.textContent = "Something went wrong.";
    }
});
