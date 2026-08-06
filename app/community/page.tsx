"use client";
import { useState, useEffect } from "react";
export default function CommunityPage() {

  const getRank = (likes: number) => {
  if (likes >= 100)
    return "👑 Market Legend";

  if (likes >= 50)
    return "🏆 Market Analyst";

  if (likes >= 25)
    return "💼 Active Investor";

  if (likes >= 10)
    return "📈 Rookie Investor";

  return "🌱 Newcomer";
};

  const [posts, setPosts] = useState<any[]>([]);

const [newPost, setNewPost] = useState("");

const [username, setUsername] = useState("");

useEffect(() => {
  const savedUsername =
  localStorage.getItem("username");

if (savedUsername) {
  setUsername(savedUsername);
}
  const savedPosts = JSON.parse(
    localStorage.getItem("communityPosts") || "[]"
  );

  if (savedPosts.length > 0) {
    setPosts(savedPosts);
  } else {
    setPosts([
      {
        title: "Is BEL still undervalued?",
        author: "Ayush",
        likes: 12,
        comments: 5,
      },
      {
        title: "Will NIFTY hit 30,000?",
        author: "Investor123",
        likes: 20,
        comments: 11,
      },
    ]);
  }
}, []);

  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>🌍 StockSphere Community</h1>
      <div style={{ marginTop: "20px" }}>
  <input
    value={username}
    onChange={(e) => {
      setUsername(e.target.value);

      localStorage.setItem(
        "username",
        e.target.value
      );
    }}
    placeholder="Choose Username"
    style={{
      padding: "12px",
      background: "#111",
      color: "white",
      border: "1px solid #333",
      borderRadius: "8px",
    }}
  />
</div>
      <div
  style={{
    marginTop: "20px",
    marginBottom: "30px",
  }}
>
  <input
  value={newPost}
  onChange={(e) =>
    setNewPost(e.target.value)
  }
  placeholder="Share your market thoughts..."
  style={{
    padding: "12px",
    width: "400px",
    maxWidth: "100%",
    background: "#111",
    color: "white",
    border: "1px solid #333",
    borderRadius: "8px",
  }}
/>

  <button
    onClick={() => {
      if (!newPost.trim()) return;

      const updatedPosts = [
  {
    title: newPost,
    author: username || "Anonymous",
    likes: 0,
    comments: 0,
  },
  ...posts,
];

setPosts(updatedPosts);

localStorage.setItem(
  "communityPosts",
  JSON.stringify(updatedPosts)
);

      setNewPost("");
    }}
    style={{
      marginLeft: "10px",
      background: "#22c55e",
      color: "white",
      border: "none",
      padding: "12px 20px",
      borderRadius: "8px",
      cursor: "pointer",
    }}
  >
    Post
  </button>
</div>

      <div style={{ marginTop: "30px" }}>
        {posts.map((post, index) => (
          <div
            key={index}
            style={{
              background: "#111",
              padding: "20px",
              borderRadius: "10px",
              marginBottom: "15px",
            }}
          >
            <h2>{post.title}</h2>

            <div
  style={{
    color: "#888",
    marginBottom: "10px",
  }}
>
  <p> <a
  href={`/profile/${post.author}`}
  style={{
    color: "#22c55e",
  }}
>
  {post.author}
</a> </p>

  <p
    style={{
      color: "#22c55e",
      fontWeight: "bold",
    }}
  >
    {getRank(post.likes || 0)}
  </p>
</div>

            <div
  style={{
    display: "flex",
    gap: "15px",
    marginTop: "10px",
  }}
>
  <button
    onClick={() => {
      const updatedPosts = [...posts];

      updatedPosts[index].likes += 1;

      setPosts(updatedPosts);

      localStorage.setItem(
        "communityPosts",
        JSON.stringify(updatedPosts)
      );
    }}
    style={{
      background: "#222",
      color: "white",
      border: "none",
      padding: "8px 12px",
      borderRadius: "6px",
      cursor: "pointer",
    }}
  >
    👍 {post.likes}
  </button>

  <span>
    💬 {post.comments}
  </span>
</div>
<div style={{ marginTop: "15px" }}>
  <input
    placeholder="Add a comment..."
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        const updatedPosts = [...posts];

        if (!updatedPosts[index].commentsList) {
          updatedPosts[index].commentsList = [];
        }

        updatedPosts[index].commentsList.push(
          e.currentTarget.value
        );

        setPosts(updatedPosts);

        localStorage.setItem(
          "communityPosts",
          JSON.stringify(updatedPosts)
        );

        e.currentTarget.value = "";
      }
    }}
    style={{
      padding: "10px",
      width: "100%",
      background: "#222",
      color: "white",
      border: "1px solid #444",
      borderRadius: "8px",
    }}
  />

  <div style={{ marginTop: "10px" }}>
    {post.commentsList?.map(
      (comment: string, i: number) => (
        <p key={i}>
          💬 {comment}
        </p>
      )
    )}
  </div>
</div>
          </div>
        ))}
      </div>
    </div>
    
  );
}