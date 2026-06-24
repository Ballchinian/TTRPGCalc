import { memo } from "react";
import { useBattleStore } from "../../../store/battleStore";
import CharacterCard from "./CharacterCard";

const gridStyle = { display: "flex", flexWrap: "wrap", justifyContent: "center", paddingTop: "10px" };

//MemoizedCard: skips rerender when the individual character prop hasn't changed
const MemoizedCard = memo(CharacterCard);

//Takes only `side`, reads its character list and all selection state from the store.
function CharacterGrid({ side }) {
    const characters = useBattleStore(state => side === "hero" ? state.parties.heroes : state.parties.foes);

    return (
        <div style={gridStyle}>
            {characters.map(char => (
                <MemoizedCard key={char.id} character={char} />
            ))}
        </div>
    );
}

export default CharacterGrid;
