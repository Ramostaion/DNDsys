import './sealed-clue.css';

/** Decorative only: opening the envelope never opens or marks a delivery as read. */
export default function SealedClueMark() {
  return (
    <span className="clue-notice-envelope" aria-hidden="true">
      <span className="clue-envelope-back" />
      <span className="clue-envelope-letter" />
      <span className="clue-envelope-front" />
      <span className="clue-envelope-flap" />
      <span className="clue-envelope-seal">✦</span>
    </span>
  );
}
